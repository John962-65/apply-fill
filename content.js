(function () {
  const SIDEBAR_ID = "resume-pro-sidebar";
  const SIDEBAR_PANEL_ID = "resume-pro-sidebar-panel";
  const SIDEBAR_DEFAULT_TOP = 96;
  const SIDEBAR_DEFAULT_RIGHT = 24;
  const STORAGE_KEYS = ["templates", "activeTemplateId", "aiConfig", "profile"];
  const FIELD_HIGHLIGHT_CLASS = "resume-pro__field-highlight";
  const FIELD_DRIFT_CLASS = "resume-pro__field-drift";
  const FIELD_HIGHLIGHT_STYLE_ID = "resume-pro-field-highlight-styles";
  const FIELD_HIGHLIGHT_STYLE_TEXT = `
.${FIELD_HIGHLIGHT_CLASS} {
  animation: resume-pro-field-highlight 2.6s ease-out forwards !important;
  outline: 2px solid rgba(34, 197, 94, 0.95) !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.14), 0 0 12px rgba(34, 197, 94, 0.5) !important;
  background-color: rgba(34, 197, 94, 0.1) !important;
}

@keyframes resume-pro-field-highlight {
  0% {
    outline-color: rgba(34, 197, 94, 0.95);
    box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.14), 0 0 12px rgba(34, 197, 94, 0.5);
    background-color: rgba(34, 197, 94, 0.1);
  }

  70% {
    outline-color: rgba(34, 197, 94, 0.8);
    box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.09), 0 0 8px rgba(34, 197, 94, 0.28);
    background-color: rgba(34, 197, 94, 0.06);
  }

  100% {
    outline-color: rgba(34, 197, 94, 0);
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
    background-color: transparent;
  }
}

.${FIELD_DRIFT_CLASS} {
  outline: 2px solid rgba(239, 68, 68, 0.95) !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.16) !important;
  background-color: rgba(239, 68, 68, 0.08) !important;
}
  `;
  const fieldHighlightTimers = new WeakMap();
  const chipSelectionIdsByTarget = new WeakMap();
  const chipWriteTargets = new WeakSet();
  let shadowRoot = null;
  const state = {
    dragOffsetX: 0,
    dragOffsetY: 0,
    dragging: false,
    sidebarUiState: null,
    currentStore: null,
    statusTimer: null,
    lastFocusedField: null,
    chipAction: null,
    lastCaptureTargets: [],
    lastInteractionFailures: []
  };

  // Read-modify-write must not interleave with the manager page's own per-key diff write,
  // or whichever side read last would overwrite the other. One queue per key family.
  function makeWriteQueue() {
    let chain = Promise.resolve();
    return (task) => {
      const run = chain.then(task, task);
      chain = run.catch(() => {});
      return run;
    };
  }

  const queueStructureWrite = makeWriteQueue();

  const StorageService = {
    // 只读。每个网页加载都会跑一次，在这里写回会用这一刻的快照盖掉设置页刚存的内容；
    // 缺省值由设置页补。例外是下面两个方法：它们都不在页面加载时跑，只在用户点确认
    // 或一次填写结束后执行，各自排队、各自只写一个键。
    async ensureDefaults() {
      const current = await chrome.storage.local.get(STORAGE_KEYS);
      return normalizeStore(current);
    },

    async getState() {
      const current = await chrome.storage.local.get(STORAGE_KEYS);
      return normalizeStore(current);
    },

    async getSidebarUiState() {
      return self.ResumeProSidebarState.readOrDefault(chrome.storage.local);
    },

    async setSidebarUiState(uiState) {
      await self.ResumeProSidebarState.write(chrome.storage.local, uiState);
    },

    async setActiveTemplate(templateId) {
      await chrome.storage.local.set({ activeTemplateId: templateId });
    },

    recordFormStructure(snapshot) {
      return queueStructureWrite(async () => {
        const api = self.ResumeProFormStructure;
        if (!api || !snapshot?.fields?.length) {
          return null;
        }

        const stored = await chrome.storage.local.get(["formStructures"]);
        // 没有版本标记的是标签可信度修复之前采的，里面存着你的值，直接丢弃。
        // 旧规则学出来的映射（姓名→项目名称这类）一并作废，结构和选项留着。
        const previous = (Array.isArray(stored.formStructures) ? stored.formStructures : [])
          .filter((held) => held?.version === 2)
          .map((held) => (api.upgradeMappings ? api.upgradeMappings(held) : held));
        const merged = api.mergeSnapshot(previous, snapshot);
        await chrome.storage.local.set({ formStructures: merged.list });
        return merged;
      });
    },

    replaceFormStructure(snapshot) {
      return queueStructureWrite(async () => {
        const api = self.ResumeProFormStructure;
        const stored = await chrome.storage.local.get(["formStructures"]);
        const list = (Array.isArray(stored.formStructures) ? stored.formStructures : [])
          .map((held) => (api?.upgradeMappings ? api.upgradeMappings(held) : held));
        const index = list.findIndex((item) => item?.version === 2 && item.platform === snapshot.platform);
        if (index < 0) {
          return false;
        }
        list[index] = snapshot;
        await chrome.storage.local.set({ formStructures: list });
        return true;
      });
    }
  };

  if (window.top !== window) {
    return;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  async function init() {
    if (document.getElementById(SIDEBAR_ID)) {
      return;
    }

    [state.currentStore, state.sidebarUiState] = await Promise.all([
      StorageService.ensureDefaults(),
      StorageService.getSidebarUiState()
    ]);
    state.sidebarUiState = self.ResumeProSidebarState.normalize(state.sidebarUiState);
    const cssText = await fetch(chrome.runtime.getURL("content.css")).then((r) => r.text());
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    injectFieldHighlightStyles();
    createSidebar(sheet);
    renderSidebar();
    bindStorageSync();
    bindFocusTracking();
    window.addEventListener("resize", constrainSidebarToViewport);
  }

  function createSidebar(sheet) {
    const uiState = self.ResumeProSidebarState.normalize(state.sidebarUiState);
    state.sidebarUiState = uiState;
    const host = document.createElement("div");
    host.id = SIDEBAR_ID;
    Object.assign(host.style, {
      position: "fixed",
      top: `${SIDEBAR_DEFAULT_TOP}px`,
      right: `${SIDEBAR_DEFAULT_RIGHT}px`,
      zIndex: "2147483647"
    });

    if (uiState.left !== null && uiState.top !== null) {
      host.style.left = `${uiState.left}px`;
      host.style.top = `${uiState.top}px`;
      host.style.right = "auto";
    }

    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: "closed" });
    shadowRoot.adoptedStyleSheets = [sheet];

    const sidebar = document.createElement("aside");
    sidebar.id = SIDEBAR_PANEL_ID;
    sidebar.className = uiState.collapsed ? "resume-pro is-collapsed" : "resume-pro";
    sidebar.innerHTML = `
      <div class="resume-pro__header" data-drag-handle="true">
        <div class="resume-pro__title-wrap">
          <p class="resume-pro__eyebrow">ApplyFill</p>
          <strong class="resume-pro__title">填表助手</strong>
        </div>
        <button class="resume-pro__collapse" type="button" aria-label="折叠助手" aria-controls="${SIDEBAR_PANEL_ID}">−</button>
      </div>
      <div class="resume-pro__body">
        <label class="resume-pro__field">
          <span>当前模板</span>
          <select class="resume-pro__select" id="resume-pro-template-select"></select>
        </label>
        <label style="display:block;margin:8px 0"><input type="checkbox" id="resume-pro-browser-input"> 实验：浏览器层点击与输入</label>
        <label style="display:block;margin:8px 0"><input type="checkbox" id="resume-pro-generic-date"> 实验：未知日期 AI 交互接管</label>
        <button class="resume-pro__ai-button" id="resume-pro-ai-fill" type="button">一键 AI 填写</button>
        <button class="resume-pro__manager-button" id="resume-pro-repeat-fill" type="button">AI 辅助新增条目（先预览）</button>
        <button class="resume-pro__manager-button" id="resume-pro-collect-fill" type="button" title="先保存网页原文，再使用已配置的 AI 接口建议分类与经历归属">采集到资料树</button>
        <button class="resume-pro__manager-button" id="resume-pro-cancel-fill" type="button" hidden>取消 AI 等待（保留本地匹配）</button>
        <p id="resume-pro-wait-hint" role="status" hidden></p>
        <div class="resume-pro__status" id="resume-pro-status" aria-live="polite"></div>
        <div class="resume-pro__fill-record" id="resume-pro-profile-offer" hidden>
          <p class="resume-pro__save-note" id="resume-pro-profile-offer-text"></p>
          <div class="resume-pro__save-actions">
            <button class="resume-pro__ai-button" type="button" id="resume-pro-profile-offer-add">加到我的信息</button>
            <button class="resume-pro__manager-button" type="button" id="resume-pro-profile-offer-skip">不用</button>
          </div>
        </div>
        <div class="resume-pro__fill-record" id="resume-pro-fill-record" hidden>
          <p class="resume-pro__save-note" id="resume-pro-fill-record-summary"></p>
          <label class="resume-pro__fill-record-option">
            <input type="checkbox" id="resume-pro-fill-record-snapshot" checked>
            <span>附上这次用的简历模板拷贝（先存在本机，传到桌面后可在申请里查看）</span>
          </label>
          <div class="resume-pro__save-actions">
            <button class="resume-pro__ai-button" type="button" id="resume-pro-fill-record-save">留档到桌面</button>
            <button class="resume-pro__manager-button" type="button" id="resume-pro-fill-record-skip">不留档</button>
          </div>
        </div>
        <details class="resume-pro__diagnostics" id="resume-pro-diagnostics" hidden>
          <summary>填写诊断（不含简历内容）</summary>
          <textarea id="resume-pro-diagnostics-text" readonly aria-label="填写诊断摘要，可选择复制" rows="14"></textarea>
        </details>
        <details class="resume-pro__diagnostics" id="resume-pro-trace" hidden>
          <summary>字段对照表（含网页字段名和简历内容，仅本机）</summary>
          <textarea id="resume-pro-trace-text" readonly aria-label="逐个网页字段的来源与写入结果，可选择复制" rows="14"></textarea>
        </details>
        <details class="resume-pro__diagnostics" id="resume-pro-structures" hidden>
          <summary>平台结构快照（只有表单结构，不含填写内容，可复制）</summary>
          <textarea id="resume-pro-structures-text" readonly aria-label="已积累的平台表单结构，可选择复制" rows="14"></textarea>
        </details>
        <details class="resume-pro__diagnostics" id="resume-pro-control-capture">
          <summary>采集控件结构（排查日期、下拉问题）</summary>
          <p>菜单卡住时，可直接导出当前结构，无需再点网页控件。也可以开始采集后手动展开控件，或让插件自动逐个点开上次没填上的控件。导出文件会移除输入框值，可能保留页面文字；不会自动上传。</p>
          <button class="resume-pro__manager-button" id="resume-pro-capture-current" type="button">直接导出当前控件结构（无需点击网页）</button>
          <button class="resume-pro__manager-button" id="resume-pro-capture-start" type="button">开始采集控件结构</button>
          <button class="resume-pro__manager-button" id="resume-pro-capture-auto" type="button">自动展开控件并导出诊断文件</button>
          <button class="resume-pro__manager-button" id="resume-pro-capture-now" type="button">补采当前面板</button>
          <button class="resume-pro__manager-button" id="resume-pro-capture-export" type="button">完成并导出诊断文件</button>
          <button class="resume-pro__manager-button" id="resume-pro-capture-stop" type="button">停止采集</button>
          <p id="resume-pro-capture-status" role="status">尚未开始采集。</p>
          <details><summary>预览采集内容</summary><textarea id="resume-pro-capture-preview" readonly rows="8" aria-label="控件结构采集预览"></textarea></details>
        </details>
        <div class="resume-pro__divider"></div>
        <div class="resume-pro__desktop">
          <button class="resume-pro__manager-button" id="resume-pro-save-job" type="button">保存岗位到本地</button>
          <button class="resume-pro__manager-button" id="resume-pro-confirm-submit" type="button">确认已投递</button>
          <form class="resume-pro__save-form" id="resume-pro-save-form" hidden>
            <label class="resume-pro__field">
              <span>公司<em>*</em></span>
              <input type="text" id="resume-pro-save-company" autocomplete="off" required>
            </label>
            <label class="resume-pro__field">
              <span>岗位<em>*</em></span>
              <input type="text" id="resume-pro-save-title" autocomplete="off" required>
            </label>
            <label class="resume-pro__field">
              <span>地点</span>
              <input type="text" id="resume-pro-save-location" autocomplete="off">
            </label>
            <label class="resume-pro__field">
              <span>来源链接</span>
              <input type="text" id="resume-pro-save-url" readonly>
            </label>
            <p class="resume-pro__save-note" id="resume-pro-save-note"></p>
            <div class="resume-pro__save-actions">
              <button class="resume-pro__ai-button" type="submit">确认保存</button>
              <button class="resume-pro__manager-button" type="button" id="resume-pro-save-cancel">取消</button>
            </div>
          </form>
          <div class="resume-pro__candidates" id="resume-pro-candidates" hidden>
            <p class="resume-pro__save-note" id="resume-pro-candidates-note"></p>
            <div class="resume-pro__candidate-list" id="resume-pro-candidate-list"></div>
            <div class="resume-pro__save-actions">
              <button class="resume-pro__ai-button" type="button" id="resume-pro-bind-new">新建一条申请</button>
              <button class="resume-pro__manager-button" type="button" id="resume-pro-bind-later">稍后再说</button>
            </div>
          </div>
          <div class="resume-pro__desktop-status" id="resume-pro-desktop-status" aria-live="polite"></div>
          <details class="resume-pro__pending" id="resume-pro-pending" hidden>
            <summary>待同步 <span id="resume-pro-pending-count">0</span> 条</summary>
            <div class="resume-pro__pending-list" id="resume-pro-pending-list"></div>
          </details>
        </div>
        <div class="resume-pro__divider"></div>
        <div class="resume-pro__groups" id="resume-pro-groups"></div>
        <div class="resume-pro__footer">
          <button class="resume-pro__manager-button" id="resume-pro-open-manager" type="button">打开管理面板</button>
          <p class="resume-pro__footer-tip">管理面板会在新的浏览器标签页打开。</p>
        </div>
      </div>
    `;

    shadowRoot.appendChild(sidebar);
    updateCollapseButton(sidebar);
    constrainSidebarToViewport();
    const chipActions = document.createElement("div");
    chipActions.id = "resume-pro-chip-actions";
    chipActions.className = "resume-pro__chip-actions";
    chipActions.hidden = true;
    chipActions.setAttribute("role", "menu");
    chipActions.setAttribute("aria-label", "字段填写方式");
    chipActions.innerHTML = `
      <button type="button" role="menuitem" data-chip-mode="add">添加</button>
      <button type="button" role="menuitem" data-chip-mode="replace">替换</button>
    `;
    shadowRoot.appendChild(chipActions);
    bindSidebarEvents(sidebar);
  }

  function bindSidebarEvents(sidebar) {
    const header = sidebar.querySelector(".resume-pro__header");
    const collapseButton = sidebar.querySelector(".resume-pro__collapse");
    const templateSelect = sidebar.querySelector("#resume-pro-template-select");
    const aiFillButton = sidebar.querySelector("#resume-pro-ai-fill");
    const openManagerButton = sidebar.querySelector("#resume-pro-open-manager");
    header.addEventListener("mousedown", startDrag);
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", stopDrag);

    collapseButton.addEventListener("click", () => {
      const host = document.getElementById(SIDEBAR_ID);
      if (!host) {
        return;
      }
      const rect = host.getBoundingClientRect();
      host.style.left = `${rect.left}px`;
      host.style.top = `${rect.top}px`;
      host.style.right = "auto";
      sidebar.classList.toggle("is-collapsed");
      updateCollapseButton(sidebar);
      persistSidebarUiState();
    });

    templateSelect.addEventListener("change", async (event) => {
      await StorageService.setActiveTemplate(event.target.value);
      showStatus("模板已切换。", "success");
    });

    aiFillButton.addEventListener("click", handleAiFillClick);
    sidebar.querySelector("#resume-pro-repeat-fill").addEventListener("click", handleRepeatFillClick);
    sidebar.querySelector("#resume-pro-collect-fill").addEventListener("click", handleCollectFillClick);
    openManagerButton?.addEventListener("click", () => openManager());
    sidebar.querySelector("#resume-pro-profile-offer-add")?.addEventListener("click", addUnansweredToProfile);
    sidebar.querySelector("#resume-pro-profile-offer-skip")?.addEventListener("click", closeProfileOffer);
    const controlCapture=self.ResumeProControlCapture.create({getInteractionFailures:()=>state.lastInteractionFailures,onUpdate:info=>{
      sidebar.querySelector('#resume-pro-capture-status').textContent=`${info.active?'采集中':'未在采集'} · ${info.count} 次快照。${info.message}`;
      sidebar.querySelector('#resume-pro-capture-preview').value=controlCapture.preview();
      sidebar.querySelector('#resume-pro-capture-start').textContent=info.active?'重新选择控件（清空本次采集）':'开始采集控件结构';
    }});
    sidebar.querySelector('#resume-pro-capture-start').addEventListener('click',()=>controlCapture.start());
    sidebar.querySelector('#resume-pro-capture-current').addEventListener('click',()=>{
      const failed=state.lastCaptureTargets.filter(item=>item.node?.isConnected);
      const targets=[...failed,...scanCaptureTargets()].filter((item,index,all)=>all.findIndex(other=>other.node===item.node)===index);
      controlCapture.exportCurrent(targets);
    });
    // 自动点击采集：复用同一套快照/脱敏/导出，只是把「用户点」换成「插件点」。
    // 组件普遍拒绝合成点击，所以勾了真实浏览器输入就走 CDP 通道；没勾就退回合成事件，
    // 并把用了哪种点击写进导出文件——「合成点击打不开面板」本身就是上游要的诊断信息。
    const captureAutoclick=self.ResumeProCaptureAutoclick.create({
      recorder:controlCapture,
      visible:isVisible,
      click:async node=>{if(browserInputEnabled()){await browserInput(node);return 'cdp';}clickComboOption(node);return 'synthetic';},
      escape:node=>browserInputEnabled()?browserEscape(node):null,
      getTargets:()=>state.lastCaptureTargets.length?state.lastCaptureTargets:scanCaptureTargets(),
      onStatus:message=>{
        sidebar.querySelector('#resume-pro-capture-status').textContent=`${controlCapture.active?'采集中':'未在采集'} · ${message}`;
        sidebar.querySelector('#resume-pro-capture-preview').value=controlCapture.preview();
      }
    });
    sidebar.querySelector('#resume-pro-capture-auto').addEventListener('click',()=>{
      captureAutoclick.run().then(result=>{
        if(!result.started&&result.skip==='running')sidebar.querySelector('#resume-pro-capture-status').textContent='正在自动采集，请等这一轮跑完。';
        if(result.started&&controlCapture.exportFile())sidebar.querySelector('#resume-pro-capture-status').textContent=`未在采集 · 自动采集完成并导出：点击 ${result.clicked} 个，打开面板 ${result.panelsOpened} 个，跳过 ${result.skipped} 个。文件含字段标签和弹层结构。`;
      }).catch(error=>{
        sidebar.querySelector('#resume-pro-capture-status').textContent=`自动采集失败：${error?.message||error}`;
      });
    });
    sidebar.querySelector('#resume-pro-capture-now').addEventListener('click',()=>controlCapture.capture());
    sidebar.querySelector('#resume-pro-capture-export').addEventListener('click',()=>controlCapture.exportFile());
    sidebar.querySelector('#resume-pro-capture-stop').addEventListener('click',()=>controlCapture.stop());
    bindDesktopEvents(sidebar);

    const chipActions = shadowRoot.querySelector("#resume-pro-chip-actions");
    chipActions?.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    chipActions?.querySelectorAll("[data-chip-mode]").forEach((actionButton) => {
      actionButton.addEventListener("click", () => handleChipAction(actionButton.dataset.chipMode));
    });
    document.addEventListener("mousedown", () => closeChipActionMenu());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeChipActionMenu();
      }
    });
  }

  function bindStorageSync() {
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      if (changes.templates || changes.activeTemplateId || changes.aiConfig || changes.profile) {
        state.currentStore = await StorageService.getState();
        renderSidebar();
      }

      const sidebarStateChange = changes[self.ResumeProSidebarState.STORAGE_KEY];
      if (sidebarStateChange && !state.dragging) {
        state.sidebarUiState = self.ResumeProSidebarState.normalize(sidebarStateChange.newValue);
        applySidebarUiState();
      }
    });
  }

  function renderSidebar() {
    if (!shadowRoot) {
      return;
    }

    const templateSelect = shadowRoot.querySelector("#resume-pro-template-select");
    const groupsContainer = shadowRoot.querySelector("#resume-pro-groups");
    const activeTemplate = getActiveTemplate(state.currentStore);
    const templates = state.currentStore?.templates || [];

    templateSelect.innerHTML = templates.length
      ? templates.map((template) => `
          <option value="${escapeHtml(template.id)}" ${template.id === state.currentStore.activeTemplateId ? "selected" : ""}>
            ${escapeHtml(template.name)}
          </option>
        `).join("")
      : '<option value="">暂无模板</option>';

    templateSelect.disabled = !templates.length;

    const profileFields = profileResumeFields();

    if (!activeTemplate && !profileFields.length) {
      groupsContainer.innerHTML = `
        <div class="resume-pro__empty">
          <p>还没有简历数据。</p>
          <button class="resume-pro__setup-button" id="resume-pro-setup-button" type="button">上传简历 / 导入模板</button>
        </div>
      `;
    } else {
      groupsContainer.innerHTML = (activeTemplate ? activeTemplate.groups : []).map((group, groupIndex) => `
      <section class="resume-pro__group">
        <div class="resume-pro__group-name">${escapeHtml(group.name)}</div>
        <div class="resume-pro__chips">
          ${group.fields.map((field, fieldIndex) => `
            <button
              class="resume-pro__chip"
              type="button"
              data-chip-id="${escapeHtml(`${activeTemplate.id}:${groupIndex}:${fieldIndex}`)}"
              data-value="${escapeHtml(field.value)}"
              title="${escapeHtml(field.value)}"
            >
              ${escapeHtml(field.key)}
            </button>
          `).join("")}
        </div>
      </section>
    `).join("") + buildProfileChipsHtml(profileFields);

      groupsContainer.querySelectorAll(".resume-pro__chip").forEach((button) => {
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
        });
        button.addEventListener("click", () => handleFieldChipClick(button));
      });
    }

    const setupButton = groupsContainer.querySelector("#resume-pro-setup-button");
    if (setupButton) {
      setupButton.addEventListener("click", () => openManager());
    }

    closeChipActionMenu();
    syncChipSelectionState();
  }

  async function handleFieldChipClick(button) {
    const value = button.dataset.value || "";
    const target = getLastFocusedFillTarget();

    closeChipActionMenu();
    if (!value) {
      return;
    }

    if (!target) {
      await copyText(value);
      return;
    }

    if (!isComposableTextTarget(target)) {
      await copyText(value);
      const filled = await Promise.resolve(setElementValue(target, value));
      if (filled) {
        target.focus?.();
        state.lastFocusedField = target;
      }
      return;
    }

    const selection = captureTextSelection(target);
    const currentValue = getComposableTargetValue(target);
    syncChipSelectionState();
    if (button.classList.contains("is-in-field")) {
      await applyChipValue(target, value, "remove", selection, button.dataset.chipId);
      return;
    }

    if (!currentValue) {
      await copyText(value);
      await applyChipValue(target, value, "add", selection, button.dataset.chipId);
      return;
    }

    showChipActionMenu(button, target, value, selection);
  }

  async function handleChipAction(mode) {
    const action = state.chipAction;
    closeChipActionMenu();
    if (!action || !["add", "replace"].includes(mode)) {
      return;
    }

    await copyText(action.value);
    const filled = await applyChipValue(action.target, action.value, mode, action.selection, action.button.dataset.chipId);
    if (!filled) {
      return;
    }
  }

  function showChipActionMenu(button, target, value, selection) {
    const menu = shadowRoot?.querySelector("#resume-pro-chip-actions");
    if (!menu) {
      return;
    }

    state.chipAction = { button, target, value, selection };
    menu.hidden = false;
    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(buttonRect.left, window.innerWidth - menuRect.width - 8));
    const fitsBelow = buttonRect.bottom + menuRect.height + 8 <= window.innerHeight;
    const top = fitsBelow ? buttonRect.bottom + 6 : Math.max(8, buttonRect.top - menuRect.height - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function closeChipActionMenu() {
    const menu = shadowRoot?.querySelector?.("#resume-pro-chip-actions");
    if (menu) {
      menu.hidden = true;
    }
    state.chipAction = null;
  }

  function captureTextSelection(target) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const fallback = target.value.length;
      return {
        start: Number.isInteger(target.selectionStart) ? target.selectionStart : fallback,
        end: Number.isInteger(target.selectionEnd) ? target.selectionEnd : fallback
      };
    }

    const selection = window.getSelection?.();
    if (!selection?.rangeCount) {
      const fallback = target.textContent?.length || 0;
      return { start: fallback, end: fallback };
    }

    const range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer)) {
      const fallback = target.textContent?.length || 0;
      return { start: fallback, end: fallback };
    }

    const beforeStart = range.cloneRange();
    beforeStart.selectNodeContents(target);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = range.cloneRange();
    beforeEnd.selectNodeContents(target);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    return { start: beforeStart.toString().length, end: beforeEnd.toString().length };
  }

  function composeChipText(currentValue, chipValue, mode, selection = {}) {
    const current = String(currentValue || "");
    const chip = String(chipValue || "");
    const rawStart = Number.isInteger(selection.start) ? selection.start : current.length;
    const start = Math.min(Math.max(0, rawStart), current.length);

    if (!chip) {
      return { value: current, caret: start, changed: false };
    }

    if (mode === "replace") {
      return { value: chip, caret: chip.length, changed: current !== chip };
    }

    if (mode === "remove") {
      const index = findNearestChipOccurrence(current, chip, start);
      if (index < 0) {
        return { value: current, caret: start, changed: false };
      }
      return {
        value: current.slice(0, index) + current.slice(index + chip.length),
        caret: index,
        changed: true
      };
    }

    return {
      value: current.slice(0, start) + chip + current.slice(start),
      caret: start + chip.length,
      changed: true
    };
  }

  function findNearestChipOccurrence(current, chip, caret) {
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let index = current.indexOf(chip);
    while (index >= 0) {
      const distance = caret < index ? index - caret : caret > index + chip.length ? caret - (index + chip.length) : 0;
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
      index = current.indexOf(chip, index + Math.max(1, chip.length));
    }
    return nearestIndex;
  }

  async function applyChipValue(target, chipValue, mode, selection, chipId = "") {
    if (!isComposableTextTarget(target) || !document.contains(target)) {
      return false;
    }

    const composed = composeChipText(getComposableTargetValue(target), chipValue, mode, selection);
    if (!composed.changed) {
      if (mode === "replace" && chipId) {
        updateTrackedChipSelection(target, chipId, mode);
        syncChipSelectionState();
        return true;
      }
      return false;
    }

    const hadTrackedSelection = chipSelectionIdsByTarget.has(target);
    const previousSelection = new Set(chipSelectionIdsByTarget.get(target) || []);
    updateTrackedChipSelection(target, chipId, mode);
    chipWriteTargets.add(target);
    let filled;
    try {
      filled = await Promise.resolve(setElementValue(target, composed.value));
    } finally {
      chipWriteTargets.delete(target);
    }
    if (!filled) {
      if (chipId) {
        if (hadTrackedSelection) {
          chipSelectionIdsByTarget.set(target, previousSelection);
        } else {
          chipSelectionIdsByTarget.delete(target);
        }
      }
      return false;
    }

    target.focus?.();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.setSelectionRange?.(composed.caret, composed.caret);
    } else {
      setContentEditableCaret(target, composed.caret);
    }
    state.lastFocusedField = target;
    syncChipSelectionState();
    return true;
  }

  function getComposableTargetValue(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      ? String(target.value || "")
      : String(target.textContent || "");
  }

  function setContentEditableCaret(target, caret) {
    const selection = window.getSelection?.();
    const range = document.createRange?.();
    if (!selection || !range) {
      return;
    }
    const textNode = target.firstChild || target;
    const offset = textNode === target ? 0 : Math.min(caret, textNode.textContent?.length || 0);
    range.setStart(textNode, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function isComposableTextTarget(target) {
    if (target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) {
      return true;
    }
    return target instanceof HTMLInputElement && ["text", "search", "tel", "url", "email", "password"].includes(target.type || "text");
  }

  function syncChipSelectionState() {
    if (!shadowRoot?.querySelectorAll) {
      return;
    }
    const target = getLastFocusedFillTarget();
    const currentValue = target && isComposableTextTarget(target) ? getComposableTargetValue(target) : "";
    const buttons = Array.from(shadowRoot.querySelectorAll(".resume-pro__chip"));
    const selectedIds = target && isComposableTextTarget(target)
      ? resolveSelectedChipIds(target, buttons, currentValue)
      : new Set();
    buttons.forEach((button) => {
      const selected = selectedIds.has(button.dataset.chipId);
      button.classList.toggle("is-in-field", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function updateTrackedChipSelection(target, chipId, mode) {
    if (!chipId) {
      return;
    }
    const selectedIds = new Set(chipSelectionIdsByTarget.get(target) || []);
    if (mode === "replace") {
      selectedIds.clear();
    }
    if (mode === "remove") {
      selectedIds.delete(chipId);
    } else {
      selectedIds.add(chipId);
    }
    chipSelectionIdsByTarget.set(target, selectedIds);
  }

  function resolveSelectedChipIds(target, buttons, currentValue) {
    const hasTrackedSelection = chipSelectionIdsByTarget.has(target);
    const previousIds = chipSelectionIdsByTarget.get(target) || new Set();
    const nextIds = new Set();
    const buttonsByValue = new Map();

    buttons.forEach((button, index) => {
      if (!button.dataset.chipId) {
        button.dataset.chipId = `rendered-chip-${index}`;
      }
      const value = button.dataset.value || "";
      if (!value) {
        return;
      }
      if (!buttonsByValue.has(value)) {
        buttonsByValue.set(value, []);
      }
      buttonsByValue.get(value).push(button);
    });

    buttonsByValue.forEach((sameValueButtons, value) => {
      let remaining = countTextOccurrences(currentValue, value);
      const preferred = sameValueButtons.filter((button) => previousIds.has(button.dataset.chipId));
      const candidates = hasTrackedSelection
        ? preferred
        : sameValueButtons;
      candidates.forEach((button) => {
        if (remaining > 0) {
          nextIds.add(button.dataset.chipId);
          remaining -= 1;
        }
      });
    });

    chipSelectionIdsByTarget.set(target, nextIds);
    return nextIds;
  }

  function countTextOccurrences(text, value) {
    if (!value) {
      return 0;
    }
    let count = 0;
    let index = String(text || "").indexOf(value);
    while (index >= 0) {
      count += 1;
      index = String(text || "").indexOf(value, index + value.length);
    }
    return count;
  }

  function newRequestId() {
    return crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join("-");
  }

  async function handleRepeatFillClick(event) {
    const button = event.currentTarget;
    const fillButton = shadowRoot.querySelector("#resume-pro-ai-fill");
    if (button.disabled || fillButton.disabled) return;
    const template = getActiveTemplate(state.currentStore);
    const config = state.currentStore?.aiConfig;
    if (!template || !config?.apiKey || !config?.apiUrl || !config?.model) {
      showStatus("请先准备简历模板和 AI 接口。", "error");
      return;
    }
    const agent = self.ResumeProFormAgent;
    const snapshot = agent.collect(document, flattenTemplateFields(template));
    if (!snapshot.candidates.length) {
      showStatus("未识别到可安全新增的分组，请先手动新增条目，再一键填写。", "error");
      return;
    }
    button.disabled = true;
    fillButton.disabled = true;
    const cancel = shadowRoot.querySelector("#resume-pro-cancel-fill");
    const hint = shadowRoot.querySelector("#resume-pro-wait-hint");
    const requestId = newRequestId();
    let stopped = false;
    let planning = true;
    let expanded;
    cancel.hidden = false;
    cancel.disabled = false;
    cancel.textContent = "停止辅助新增";
    cancel.onclick = () => {
      stopped = true;
      cancel.disabled = true;
      if (planning) self.ResumeProAIClient.cancel(requestId).catch(() => {});
    };
    const start = performance.now();
    const progress = () => {
      const seconds = Math.floor((performance.now() - start) / 1000);
      button.textContent = `AI 规划中... ${seconds}s`;
      if (seconds >= 90) {
        hint.hidden = false;
        hint.textContent = "正在等待 AI 规划，上游模型、中转或网络可能较慢；不会自动取消，可手动停止。";
      }
    };
    progress();
    const timer = window.setInterval(progress, 1000);
    try {
      const reply = await self.ResumeProAIClient.send({ type: "AI_PLAN_REPEAT", requestId, aiConfig: config, candidates: snapshot.candidates });
      planning = false;
      window.clearInterval(timer);
      if (stopped) throw new Error("已停止，未执行新增。");
      if (!reply?.success) throw new Error("AI 规划失败，未执行新增。可稍后重试或手动新增。");
      const plan = agent.validatePlan(reply.plan, snapshot.candidates);
      if (!plan.length) throw new Error("AI 未给出可确认的新增操作，请手动处理。");
      const preview = plan.map(action => `${snapshot.candidates.find(c => c.id === action.id).label}：${action.count} 条`).join("\n");
      if (!window.confirm(`允许以下操作吗？\n${preview}\n\n确认后将点击网页新增按钮，再用 AI 填写这些分组的空字段。不会提交、删除或覆盖已有内容。网页自身可能保存新条目；停止后不自动删除。`)) return;
      if (getActiveTemplate(state.currentStore) !== template) throw new Error("当前模板已变化，请重新预览。");
      button.textContent = "正在新增并检查网页...";
      hint.hidden = true;
      expanded = await agent.execute(plan, snapshot, () => stopped || getActiveTemplate(state.currentStore) !== template);
    } catch (error) {
      showStatus(error.message || "辅助新增失败，请手动核对网页。", "error");
    } finally {
      window.clearInterval(timer);
      cancel.hidden = true;
      cancel.onclick = null;
      cancel.textContent = "取消 AI 等待（保留本地匹配）";
      hint.hidden = true;
      button.disabled = false;
      fillButton.disabled = false;
      button.textContent = "AI 辅助新增条目（先预览）";
    }
    if (expanded && !stopped && getActiveTemplate(state.currentStore) === template) await handleAiFillClick({ currentTarget: fillButton }, { scopes: expanded.scopes });
  }

  function isAssistedTextField(entry) {
    const el = entry.element;
    return !el.disabled && !el.readOnly && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && ["text", "email", "tel", "url", "search"].includes(el.type)));
  }

  // 有组件把字段标签直接画在控件内部，取触发器文本时要把 label 剔掉，
  // 否则「民族」这种标签会被当成已选中的值，字段就被判成已经填过了。
  function comboTriggerText(trigger) {
    if (!trigger?.cloneNode) {
      return "";
    }
    const clone = trigger.cloneNode(true);
    clone.querySelectorAll?.("label").forEach((element) => element.remove());
    return clone.textContent || "";
  }

  // Frameworks may replace nodes after a change event. Rebind only a unique structural identity.
  function refreshFieldEntry(meta, entry) {
    const anchor = entry?.kind === "radio" ? entry.elements?.[0] : entry?.trigger || entry?.element;
    if (anchor?.isConnected) return entry;
    if (!meta) return null;
    const scan = scanFillableFields();
    const api = self.ResumeProFormStructure;
    const candidates = scan.fields.filter(field => api.fieldIdentity(field) === api.fieldIdentity(meta)
      && (!meta.recordSignature || field.recordSignature === meta.recordSignature)
      && (!meta.idAttr || field.idAttr === meta.idAttr)
      && (!meta.name || field.name === meta.name));
    if(candidates.length!==1)return null;
    const next=scan.fieldMap.get(candidates[0].fieldId);
    // A dynamically discovered autocomplete may remove its only list on selection.
    // Retain that proven driver when the same unique field is rebuilt as a text input.
    if(entry?.kind==='combobox'&&entry.structuralChoice&&next?.kind==='element'){
      const root=structuralChoiceRoot(next.element,true);
      return root?promoteStructuralChoice(next,root):null;
    }
    return next;
  }

  function hasExistingValue(entry) {
    if (entry.kind === "radio") return entry.elements.some(el => el.checked);
    const el = entry.kind === "combobox" ? entry.trigger : entry.element;
    if (!el || !el.isConnected) return true;
    if (el?.type === "checkbox") return el.checked;
    return Boolean(readBackValue(entry));
  }

  // 只用于诊断：写进去和页面真的认了是两件事。自定义下拉的触发框往往是 readonly 的
  // input，值写成功、事件也发了，组件按自己的 state 重渲染，界面上还是占位文案。
  function readBackValue(entry) {
    if (entry.kind === "radio") {
      const checked = (entry.elements || []).find((el) => el.checked);
      return checked ? getRadioOptionLabel(checked) : "";
    }

    if (entry.kind === "combobox") return comboAgent.read(entry);

    const el = entry.element;
    if (!el?.isConnected) return "";
    if (udDateAgent.recognizes(entry)) return udDateAgent.read(entry);
    if (el instanceof HTMLSelectElement) {
      const option = el.options[el.selectedIndex];
      return !option || self.ResumeProAIHelpers.isPlaceholderOption({ value: option.value, text: option.text, disabled: option.disabled }) ? "" : option.text.trim();
    }
    if (entry.displayDate) {
      const shown=sanitizeLabelText(el.textContent);
      return isFormatPlaceholder(shown)?'':shown;
    }
    if (el.type === "checkbox" || el.type === "radio") return el.checked ? "已勾选" : "";

    const typed = String(el.value ?? "").trim();
    if (typed && !isFormatPlaceholder(typed)) return typed;
    // 藏起来的 input 读不到值时看容器显示的文本 —— 有些日期组件只把日期画在 div 里。
    if (entry.hiddenInput && entry.pickerRoot?.isConnected) {
      const shown = sanitizeLabelText(comboTriggerText(entry.pickerRoot));
      return shown && !isFormatPlaceholder(shown) ? shown.slice(0, 40) : "";
    }
    return String(el.value ?? el.textContent ?? "").trim();
  }

  // 「YYYY」「yyyy-MM-dd」「请选择」这类是控件的占位文案，不是内容。
  // 复读校验把它当成已填的值，就会把没填上的字段报成填好了。
  function isFormatPlaceholder(text) {
    const shown = sanitizeLabelText(text);
    return COMBO_PLACEHOLDER.test(shown)
      || /^(yyyy|yy|mm|dd|hh|ss|年|月|日|时|分|秒|[-\/:.\s])+$/i.test(shown);
  }

  function verifyFilledValue(entry, value, inputType) {
    const anchor = entry?.kind === 'radio' ? entry.elements?.[0] : entry?.trigger || entry?.element;
    if (!anchor?.isConnected) return false;
    const expected = String(value ?? "").trim();

    if (entry.kind === "radio") {
      const options = entry.elements.map((radio) => ({ value: radio.value, text: getRadioOptionLabel(radio), disabled: radio.disabled }));
      const checkedIndex = entry.elements.findIndex((radio) => radio.checked);
      // 和写入时同一套判定：包裹式 label 会让选项文本带上分组标题（「性别男」），
      // 直接比字符串会把填对的单选误报成没生效。
      return checkedIndex >= 0 && self.ResumeProAIHelpers.findSelectOptionIndex(options, expected, entry.meta) === checkedIndex;
    }

    if (entry.kind === "combobox") {
      const shown = readBackValue(entry);
      return Boolean(shown) && (self.ResumeProFormStructure.normalizeLabel(shown) === self.ResumeProFormStructure.normalizeLabel(expected) || Boolean(entry.verifiedChoice && shown === entry.verifiedChoice));
    }
    if (entry.element?.type === 'checkbox') {
      const wanted = self.ResumeProAIHelpers.checkboxState(value, entry.meta?.label || getCheckboxLabel(entry.element));
      return wanted !== null && entry.element.checked === wanted;
    }

    const actual = readBackValue(entry);
    if (actual === expected) {
      return true;
    }
    if (entry.element instanceof HTMLSelectElement && entry.element.value === value) {
      return true;
    }
    if (entry.element instanceof HTMLSelectElement) {
      const options = Array.from(entry.element.options).map(option => ({value:option.value,text:option.text,disabled:option.disabled}));
      const index = self.ResumeProAIHelpers.findSelectOptionIndex(options, expected, entry.meta);
      return index >= 0 && entry.element.selectedIndex === index;
    }
    // 日期控件写入前会被归一（「2000年1月1日」→「2000-01-01」），读回要按同一套规则比，
    // 否则填对的也会被报成没生效。
    const normalized = self.ResumeProAIHelpers?.normalizeDateValue?.(expected, inputType);
    return Boolean(normalized && normalized !== expected && actual === normalized);
  }

  // 匹配前只观察已展开的选项；实际填写时再打开、读取并确认选择。
  async function prefetchComboOptions(fields, fieldMap) {
    // Passive observation only. Opening/searching/scrolling belongs to the
    // grounded field transaction, after AI matching, never to whole-page setup.
    const report = { optionMode:'on-demand', optionAttempts:0, optionObserved:0, optionFailures:0, optionErrors:[] };
    for (const field of fields) {
      if (field.inputType !== "combobox") {
        continue;
      }
      const entry = fieldMap.get(field.fieldId);
      // Cached lists and virtualized observations are hints, never the complete vocabulary.
      field.options = [];
      field.optionsSource = "unobserved";
      field.optionsComplete = false;
      if (!entry || entry.kind !== "combobox") {
        continue;
      }
      entry.meta=field;
      const texts=comboAgent.observe(entry).map(n=>(n.getAttribute('aria-label')||n.textContent||'').trim())
        .filter(text=>!isFormatPlaceholder(text)).slice(0,60);
      if(texts.length){field.options=texts;field.optionsSource='live';entry.observedOptions=texts;report.optionObserved++;}
    }
    return report;
  }

  // 下拉列表里真正会滚的那个容器。组件库把滚动挂在不同层上，
  // 显式的虚拟列表类名找不到就按「内容比可视区高」认。
  function comboScrollContainer(entry) {
    const dropdown = comboDropdownFor(entry);
    if (!dropdown) {
      return null;
    }

    const scrollable = (node) => node && node.clientHeight > 40 && node.scrollHeight > node.clientHeight + 8;
    const explicit = Array.from(dropdown.querySelectorAll("[class*='virtual'], [class*='scroll'], [role='listbox'], ul, [class*='list']"))
      .find(scrollable);
    if (explicit) {
      return explicit;
    }

    return Array.from(dropdown.querySelectorAll("*")).find(scrollable) || (scrollable(dropdown) ? dropdown : null);
  }

  // 边滚边收，直到滚到底或连续几步都没有新选项。
  async function collectAllComboOptions(entry, options) {
    const api = self.ResumeProFormStructure;
    const seen = new Map();
    const take = (list) => list.forEach((option) => {
      const text = sanitizeLabelText(option.textContent) || option.getAttribute("aria-label") || "";
      if (text) {
        seen.set(api.normalizeLabel(text), text);
      }
    });

    take(options || []);
    const scroller = comboScrollContainer(entry);
    if (!scroller) {
      return Array.from(seen.values());
    }

    let idle = 0;
    for (let step = 0; step < 15 && idle < 3; step += 1) {
      const before = seen.size;
      scroller.scrollTop += Math.max(40, scroller.clientHeight - 8);
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 90));
      take(freshOptionsFor(entry));
      idle = seen.size === before ? idle + 1 : 0;
    }

    return Array.from(seen.values());
  }

  // 要点的选项还没被虚拟列表渲染出来：滚动找它，找到就停在点得到的位置。
  // 不能直接拿预读阶段的节点引用去点 —— 滚出去之后那个节点已经脱离文档了。
  async function revealOptionInList(entry, value, options) {
    const api = self.ResumeProFormStructure;
    const wanted = api.normalizeLabel(value);
    const scroller = comboScrollContainer(entry);
    if (!scroller) {
      return options;
    }

    const hit = () => freshOptionsFor(entry).find((option) => {
      const norm = api.normalizeLabel(option.textContent);
      return norm === wanted || (norm.length >= 2 && (wanted.endsWith(norm) || norm.endsWith(wanted)));
    });

    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));

    for (let step = 0; step < 20; step += 1) {
      const target = hit();
      if (target) {
        target.scrollIntoView({ block: "nearest" });
        await new Promise((resolve) => setTimeout(resolve, 60));
        return freshOptionsFor(entry);
      }
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        break;
      }
      scroller.scrollTop += Math.max(40, scroller.clientHeight - 8);
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 90));
    }

    const rendered = freshOptionsFor(entry);
    return rendered.length ? rendered : options;
  }

  // 全部填完再统一复读一次。成对起止时间这类控件会互相顶值，边填边读看不出来；
  // 读回来的值正好是别的字段该填的，就说明值串到这一行来了。
  function reviewFieldName(meta = {}) {
    const name = [meta.labelUnreliable ? '' : meta.label, meta.name].find(value => value && !isFormatPlaceholder(value));
    const kind = /select|combobox/.test(meta.inputType || '') ? '下拉框' : '字段';
    const part={year:'年',month:'月',day:'日'}[meta.datePart];
    return `${meta.group ? `[${meta.group}] ` : ''}${meta.recordIndex ? `第 ${meta.recordIndex} 条 · ` : ''}${name || `未识别名称的${kind}（${meta.fieldId || '位置未知'}）`}${part ? ` · ${part}` : ''}`;
  }

  async function verifyWrittenValues(written, outcomes, {focus=true}={}) {
    if (!written.size) {
      return { drift: 0, swapped: 0, manual: [] };
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
    const records = [...written.values()];
    let drift = 0;
    let swapped = 0;
    const manual = [];
    let firstFocus;

    written.forEach((record, fieldId) => {
      const refreshed = refreshFieldEntry(record.meta, record.entry);
      record.entry = refreshed ? {...record.entry,...refreshed} : record.entry;
      const related=record.meta?.rangeId?records.filter(r=>r.meta?.rangeId===record.meta.rangeId):[];
      const start=related.find(r=>r.meta.rangeRole==='start'),end=related.find(r=>r.meta.rangeRole==='end');
      const peer=record.entry.rangePeer;
      const peerStart=record.meta?.rangeRole==='end'?peer:record.entry,peerEnd=record.meta?.rangeRole==='start'?peer:record.entry;
      const splitMembers=record.entry.rangeMembers;
      const rangeOk=!record.meta?.rangeId||(splitMembers?.length?validDateOrder(
        rangeEndpointValue(splitMembers.map(item=>item.meta),'start',meta=>{const item=splitMembers.find(item=>item.meta.fieldId===meta.fieldId);return readBackValue(refreshFieldEntry(meta,item.entry)||item.entry);}),
        rangeEndpointValue(splitMembers.map(item=>item.meta),'end',meta=>{const item=splitMembers.find(item=>item.meta.fieldId===meta.fieldId);return readBackValue(refreshFieldEntry(meta,item.entry)||item.entry);}))
        :start&&end?validDateOrder(readBackValue(refreshFieldEntry(start.meta,start.entry)||start.entry),readBackValue(refreshFieldEntry(end.meta,end.entry)||end.entry))
        : Boolean(peer&&validDateOrder(readBackValue(peerStart),readBackValue(peerEnd))));
      const scope=record.entry.rangeRoot||record.entry.pickerRoot;
      const pageError=scope&&Array.from(scope.querySelectorAll('[role="alert"],[class*="error"]')).some(n=>isVisible(n)&&n.textContent.trim());
      if (rangeOk && !pageError && verifyFilledValue(record.entry, record.value, record.inputType)) {
        outcomes.set(fieldId, { ok: true });
        return;
      }

      const actual = readBackValue(record.entry);
      const other = records.find((item) => item !== record && actual && String(item.value).trim() === actual);
      outcomes.set(fieldId, { ok: false, readBack: actual, swappedWith: other?.label || "", failureReason: !rangeOk ? "日期区间不完整或顺序异常" : pageError ? "页面仍显示校验错误" : !refreshed ? "控件已替换，无法唯一定位" : !actual ? "读回为空或占位文字" : "读回内容与预期不同" });
      highlightFilledField(record.entry, record.value, "drift");
      // 合成事件驱动不了的组件（ant 3.x 的下拉、日历）不再静默失败：
      // 焦点放好、状态条点名，用户几秒就能手填。
      manual.push(record.meta ? reviewFieldName(record.meta) : record.label);
      const focusTarget = record.entry?.kind === "radio" ? record.entry.elements?.[0] : record.entry?.trigger || record.entry?.element;
      if (!firstFocus && focusTarget?.isConnected) firstFocus = focusTarget;
      drift += 1;
      if (other) swapped += 1;
    });

    if(focus)firstFocus?.focus?.();
    return { drift, swapped, manual };
  }

  // 刚在 chrome://extensions 点过「重新加载」时，旧页面上这份脚本还活着但已经连不上扩展，
  // 任何 chrome.* 都会抛。与其让它报错，不如直接说清楚要刷新页面。
  function requireContext() {
    if (contextAlive()) {
      return true;
    }

    showStatus("插件刚更新过，这个页面里跑的还是旧脚本。刷新页面就能用。", "error", true);
    return false;
  }

  function validDateOrder(start,end){
    const parse=value=>{
      const m=String(value).match(/^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2}))?/);
      if(!m)return NaN;
      const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]||1);
      return month>=1&&month<=12&&day>=1&&day<=new Date(year,month,0).getDate()?year*10000+month*100+day:NaN;
    };
    const a=parse(start),b=parse(end);return Number.isFinite(a)&&Number.isFinite(b)&&a<=b;
  }

  function rangeEndpointValue(fields, role, getValue) {
    const endpoint=fields.filter(field=>field.rangeRole===role);
    if(endpoint.length===1&&!endpoint[0].datePart)return getValue(endpoint[0]);
    const parts={};
    for(const field of endpoint){
      if(!field.datePart||Object.hasOwn(parts,field.datePart))return '';
      parts[field.datePart]=self.ResumeProAIHelpers.normalizeDatePart(getValue(field),field.datePart);
      if(!parts[field.datePart])return '';
    }
    return parts.year&&parts.month?`${parts.year}-${parts.month}${parts.day?'-'+parts.day:''}`:'';
  }

  function rangeMatchReason(fields, matches) {
    const proofs=fields.map(field=>matches.find(match=>match.fieldId===field.fieldId));
    if(proofs.some(proof=>!proof))return '起止时间缺少成对来源';
    if(proofs.some(proof=>!proof.resumeRecordId)||new Set(proofs.map(proof=>JSON.stringify([
      proof.resumeGroupId||proof.resumeGroup||'',proof.resumeRecordId]))).size!==1)return '起止时间无法确认来自同一条简历记录';
    const value=field=>proofs[fields.indexOf(field)].value;
    return validDateOrder(rangeEndpointValue(fields,'start',value),rangeEndpointValue(fields,'end',value))
      ?'':'来源日期顺序异常或不明确，未自动交换';
  }

  function currentRecordStateReason(meta,fields,fieldMap){
    const key=f=>JSON.stringify([f.group,f.recordIndex,f.recordSignature]);
    const evidence=fields.filter(f=>key(f)===key(meta)&&f.currentValue);
    for(const field of evidence){
      const entry=refreshFieldEntry(field,fieldMap.get(field.fieldId));
      if(!entry||self.ResumeProFormStructure.normalizeLabel(readBackValue(entry))!==self.ResumeProFormStructure.normalizeLabel(field.currentValue))
        return '网页已有记录在匹配后变化，已停止本条填写，请重新扫描';
    }
    return '';
  }

  async function decideInteraction(observation,aiConfig,button){
    const requestId='interaction-'+crypto.randomUUID();
    const stop=document.createElement('button');stop.type='button';stop.textContent='停止 AI 交互';
    let stopped=false;
    stop.onclick=()=>{stopped=true;button.dataset.interactionStopped='true';stop.disabled=true;self.ResumeProAIClient.cancel(requestId).catch(()=>{});};
    button.insertAdjacentElement('afterend',stop);
    try{
      const response=await self.ResumeProAIClient.send({type:'AI_INTERACTION_STEP',requestId,aiConfig,observation});
      if(stopped)throw new Error('已停止 AI 交互');
      if(!response?.success)throw new Error(response?.error||'AI 交互未返回有效操作');
      return response.action;
    }finally{stop.remove();}
  }

  // 日期填写路由：规则适配器先行（0 次模型调用），失败后按实验开关交给通用日期 Agent 接管。
  // 接管前先做脏状态检查；peer 基线在适配器尝试之前取，适配器改坏的另一端不会被当成基线。
  function genericDateEnabled(){
    const mode = self.__APPLY_FILL_DATE_MODE__;
    if (mode === 'adapters-only') return false;
    if (mode === 'agent-only') return true;
    return Boolean(shadowRoot?.querySelector('#resume-pro-generic-date')?.checked);
  }
  async function fillDateWithAgent(entry,value,meta){
    if (entry.element?.matches?.('[type="checkbox"],[type="radio"]')) {
      entry.fillNote='勾选控件不能按日期填写';return false;
    }
    entry.interactions=[];
    const trace=(action,detail='')=>entry.interactions.push({action,detail});
    if (self.__APPLY_FILL_DATE_MODE__ !== 'agent-only' && readBackValue(entry)
      && verifyFilledValue(entry, readBackValue(entry), meta.inputType)) {
      entry.fillNote='';return {ok:true,value:readBackValue(entry)};
    }
    const peerBefore = entry.rangePeer ? readBackValue(entry.rangePeer) : undefined;
    let result=false;
    if (self.__APPLY_FILL_DATE_MODE__ !== 'agent-only') {
      try{result=await setElementValue(entry,value);}
      catch(error){result={ok:false,reason:error.message};}
      await new Promise(r=>setTimeout(r,180));
      if (result && (typeof result!=='object'||result.ok) && verifyFilledValue(entry,result?.value||value,meta.inputType)) {
        entry.fillNote='';return result;
      }
    }
    const reason=(typeof result==='object'&&result?.reason)||entry.fillNote||'日期适配未通过核对';
    trace('规则适配未完成',reason);
    if (!genericDateEnabled()) { entry.fillNote=reason; return false; }
    const inspect = self.ResumeProGenericDateAgent
      ? genericDateAgent.inspectHandoff(entry, { peerBefore })
      : { safe:false, code:'GENERIC_AGENT_UNAVAILABLE' };
    if (!inspect.safe) {
      entry.popupBlocked=true;
      entry.fillNote = inspect.code==='PEER_CHANGED' ? '接管前发现另一端日期已被改变，停止本条经历'
        : inspect.code==='GENERIC_AGENT_UNAVAILABLE' ? '通用日期模块未加载' : '接管前页面状态无法解释，未继续';
      entry.interactionResult={status:'BLOCKED',code:inspect.code||'HANDOFF_UNSAFE'};
      trace('接管前检查未通过',entry.fillNote);
      return false;
    }
    try {
      const takeover = await genericDateAgent.fill(entry, value, null, { ...inspect, peerBefore });
      if (takeover.ok) { entry.fillNote=''; return takeover; }
      entry.fillNote = takeover.reason || reason;
      entry.interactionResult={status:takeover.status==='BLOCKED'?'BLOCKED':takeover.status==='SKIPPED'?'SKIPPED':'RECOVERED',code:takeover.code||'VALUE_UNCONFIRMED'};
      if (takeover.status==='BLOCKED') entry.popupBlocked=true;
      trace('AI 接管未完成',entry.fillNote);
      return false;
    } catch (error) {
      entry.fillNote=error.message;
      entry.interactionResult={status:'RECOVERED',code:'VALUE_UNCONFIRMED'};
      return false;
    }
  }

  async function handleAiFillClick(event, assisted = null) {
    const button = event.currentTarget;
    if (button.disabled) return;
    if (!requireContext()) return;
    const activeTemplate = getActiveTemplate(state.currentStore);
    const aiConfig = state.currentStore?.aiConfig;

    const profileFields = profileResumeFields();

    if (!activeTemplate && !profileFields.length) {
      showStatus("请先导入简历模板，或在「我的信息」里填写内容。", "error");
      return;
    }

    if (!aiConfig?.apiUrl || !aiConfig?.model || !aiConfig?.apiKey) {
      showStatus("请先在插件中配置 AI 接口。", "error");
      return;
    }

    button.disabled = true;
    state.lastInteractionFailures=[];
    // Warm the desktop modules while the fill runs, so that when it ends the page can be read
    // for the archive offer without waiting on anything (see offerFillRecord).
    loadDesktopModules().catch(() => {});
    const repeatButton = shadowRoot?.querySelector("#resume-pro-repeat-fill");
    if (repeatButton) repeatButton.disabled = true;
    const collectButton = shadowRoot?.querySelector("#resume-pro-collect-fill");
    if (collectButton) collectButton.disabled = true;
    button.textContent = "正在扫描网页...";
    const totalStart = performance.now();
    const timing = { scanMs: null, optionsMs: null, roundTripMs: null, fillMs: null };
    let phaseStart = totalStart;
    let phase = "scanMs";
    let stage = "scan";
    let timer = null;
    let diagnostics = {};
    let fieldCount = 0;
    let filledCount = 0;
    let unconfirmedCount = 0;
    const unfilledLabels = [];
    const notAttemptedLabels = [];
    const locallySkippedLabels = [];
    const traceOutcomes = new Map();
    const writtenEntries = new Map();
    let traceText = "";
    let structureText = "";
    let driftCount = 0;
    let swappedCount = 0;
    let mappingFilledCount = 0;
    let keptCount = 0;
    const dateNotices = new Map();
    let unlabeledCombos = 0;
    let droppedControls = [];
    let droppedTotal = 0;
    let learnedNote = "";
    let outcome = "failed";
    const requestId = newRequestId();
    const cancelButton = shadowRoot?.querySelector("#resume-pro-cancel-fill");
    const waitHint = shadowRoot?.querySelector("#resume-pro-wait-hint");
    let cancelRequested = false;

    try {
      const scanned = scanFillableFields();
      const fieldMap = scanned.fieldMap;
      unlabeledCombos = scanned.unlabeledCombos || 0;
      droppedControls = scanned.dropped || [];
      droppedTotal = scanned.droppedTotal || 0;
      const fields = assisted ? scanned.fields.filter(field => {
        const entry = fieldMap.get(field.fieldId);
        return entry?.kind === "element" && isAssistedTextField(entry) && assisted.scopes.some(scope => scope.contains(entry.element)) && !hasExistingValue(entry);
      }) : scanned.fields;
      fieldCount = fields.length;
      timing.scanMs = performance.now() - phaseStart;
      phase = null;
      if (!fields.length) throw new Error("当前页面没有可填写的表单字段。");
      if (!assisted) closeProfileOffer();
      // 模板字段在前并且优先；「我的信息」只补模板里没有的字段名。
      const templateFields = activeTemplate ? flattenTemplateFields(activeTemplate) : [];
      // 区间时间拆开始/结束、奖项名补成字段：资料树里这些事实的存放形状按值回查认不出来，
      // 不补的话真实出处会被判成「编造」再被来源校验拦掉。只作用于本次发送，不改存储。
      const resumeFields = self.ResumeProAIHelpers.expandResumeFields(
        self.ResumeProProfile
          ? self.ResumeProProfile.mergeResumeFields(templateFields, profileFields)
          : templateFields
      );
      // 平台映射：上次在这套表单上确认过的对应关系，直接按简历字段填，不再问模型。
      const platformSnapshot = assisted ? null : await loadPlatformSnapshot();
      // Observe visible lists without opening anything. Missing lists remain
      // unknown until the actual field is filled, not a forbidden empty enum.
      stage = 'options';
      phase = 'optionsMs';
      phaseStart = performance.now();
      button.textContent = '正在整理网页字段...';
      diagnostics = await prefetchComboOptions(fields, fieldMap);
      timing.optionsMs = performance.now() - phaseStart;
      phase = null;
      // Record identity comes from the live page, not only the model's proposed
      // name. Existing names must constrain dates even when rows change order.
      const recordEvidence=/^(学校名称|学校|院校名称|专业|专业名称|所学专业|项目名称|课题名称|获奖名称|获奖项|奖项名称|奖励名称|公司名称|单位名称|组织名称|活动名称|语言类型|语言|语种|(?:(?:项目|职务|工作|实习|经历)?(?:描述|内容))|项目中职责|职责|概述|内容概述|主要工作|职责描述)$/;
      for(const field of fields){
        if(!recordEvidence.test(field.label||'')&&!field.datePart&&!/^(开始时间|结束时间|获奖时间|获奖日期)$/.test(field.label||''))continue;
        const entry=refreshFieldEntry(field,fieldMap.get(field.fieldId));
        if(entry){fieldMap.set(field.fieldId,entry);const current=readBackValue(entry);if(current)field.currentValue=current;}
      }
      const mapped = platformSnapshot
        ? mappingMatches({ fields, snapshot: platformSnapshot, resumeFields })
        : { matches: [], answered: new Set() };
      // Keep the full row available when a missing field needs record evidence.
      // Cached names alone must not hide the education/language/award identity
      // from a newly derived or combined field.
      const recordKey=f=>JSON.stringify([f.group,f.recordIndex,f.recordSignature]);
      const needsProof=f=>f.datePart || f.rangeId || (f.recordIndex&&/时间|日期/.test(f.label)) || (!mapped.answered.has(f.fieldId)
        && (self.ResumeProAIHelpers.educationFieldTopic(f) || self.ResumeProAIHelpers.selectEnumTopic(f)
          || /^(职务名称|职位名称|担任职务|职务|项目角色)$/.test(f.label || '')));
      const contextRecords=new Set(fields.filter(needsProof).map(recordKey));
      const rematchIds=new Set(fields.filter(f=>contextRecords.has(recordKey(f))).map(f=>f.fieldId));
      mapped.matches=mapped.matches.filter(m=>!rematchIds.has(m.fieldId));
      for(const id of rematchIds)mapped.answered.delete(id);
      const aiFields = fields.filter((field) => !mapped.answered.has(field.fieldId));
      stage = 'match';
      phase = "roundTripMs";
      phaseStart = performance.now();
      if (cancelButton) {
        cancelButton.hidden = false;
        cancelButton.disabled = false;
        cancelButton.onclick = async () => {
          if (phase !== "roundTripMs") return;
          cancelButton.disabled = true;
          try {
            const reply = await self.ResumeProAIClient.cancel(requestId);
            if (reply?.cancelled) cancelRequested = true;
            if (waitHint && phase === "roundTripMs") {
              waitHint.hidden = false;
              waitHint.textContent = reply?.cancelled ? "正在取消 AI 等待，保留本地匹配结果。" : "请求已结束或无法取消，正在等待结果。";
            }
          } catch {
            if (phase === "roundTripMs") {
              cancelButton.disabled = false;
              if (waitHint) {
                waitHint.hidden = false;
                waitHint.textContent = "取消请求未送达，请重试；当前请求可能仍在等待。";
              }
            }
          }
        };
      }
      const updateProgress = () => {
        const seconds = Math.floor((performance.now() - phaseStart) / 1000);
        button.textContent = `AI 匹配中... ${seconds}s`;
        if (seconds >= 90 && waitHint && !cancelRequested) {
          waitHint.hidden = false;
          waitHint.textContent = "AI 匹配尚未返回，等待通常与上游模型处理、中转服务或网络有关，输入量也会影响耗时。插件不会因等待较久自动取消；你可以继续等待或手动取消。";
        }
      };
      updateProgress();
      timer = window.setInterval(updateProgress, 1000);
      const response = aiFields.length ? await self.ResumeProAIClient.send({
        type: "AI_FILL",
        requestId,
        formFields: aiFields,
        resumeFields,
        aiConfig
      }) : {
        success: true, matches: [],
        diagnostics: { ruleMatches: 0, aiFields: 0, aiMatches: 0, candidateFields: 0,
          resumeFields: resumeFields.length, apiMs: 0, promptBytes: 0, errorCode: "none" }
      };
      timing.roundTripMs = performance.now() - phaseStart;
      phase = null;
      window.clearInterval(timer);
      timer = null;
      if (cancelButton) cancelButton.hidden = true;
      if (waitHint) waitHint.hidden = true;
      diagnostics = { ...diagnostics, ...(response?.diagnostics || {}) };
      for(const rejection of diagnostics.sourceRejections||[]){const field=fields.find(f=>f.fieldId===rejection.fieldId);if(field){field.sourceRejection=rejection.reason;field.sourceRejectionValue=rejection.value;}}

      if (!response?.success) {
        throw new Error(response?.error || "AI 填写失败。");
      }

      button.textContent = "正在填写网页...";
      stage = 'fill';
      phase = "fillMs";
      phaseStart = performance.now();

      const fieldMetaMap = new Map(fields.map((f) => [f.fieldId, f]));
      const domOrderMap = new Map(fields.map((field, index) => [field.fieldId, index]));
      const allMatches = [...mapped.matches, ...(response.matches || [])];
      const sortedMatches = allMatches.sort((a, b) => {
        const ma = fieldMetaMap.get(a.fieldId);
        const mb = fieldMetaMap.get(b.fieldId);
        if (ma?.cascadeGroup !== undefined && ma.cascadeGroup === mb?.cascadeGroup) {
          return (ma.cascadeLevel ?? 0) - (mb.cascadeLevel ?? 0);
        }
        // 其余按页面顺序从上往下填：没被识别成联动组的省/市/县也能等上一级先选好。
        return (domOrderMap.get(a.fieldId) ?? 0) - (domOrderMap.get(b.fieldId) ?? 0);
      });

      delete button.dataset.interactionStopped;
      for (const match of sortedMatches) {
        if(button.dataset.interactionStopped==='true')break;
        if (assisted && getActiveTemplate(state.currentStore) !== activeTemplate) throw new Error("模板已变化，已停止辅助填写，请核对网页。");
        let element = refreshFieldEntry(fieldMetaMap.get(match.fieldId), fieldMap.get(match.fieldId));

        if (!element) continue;
        fieldMap.set(match.fieldId, element);
        if (assisted && (!isAssistedTextField(element) || hasExistingValue(element) || !assisted.scopes.some(scope => scope.isConnected && scope.contains(element.element)))) continue;

        // 用户定的规则：网页上已经有内容的字段，插件一律不动 —— 哪怕 AI 认为该改。
        // 跳过不算失败，单独计数；对照表里会点名，免得看起来像漏填。
        if (!assisted && hasExistingValue(element)) {
          keptCount += 1;
          traceOutcomes.set(match.fieldId, { ok: false, kept: true });
          continue;
        }

        const meta=fieldMetaMap.get(match.fieldId);
        element.meta=meta;
        const recordChanged=currentRecordStateReason(meta,fields,fieldMap);
        if(recordChanged){element.fillNote=recordChanged;traceOutcomes.set(match.fieldId,{ok:false});unfilledLabels.push(reviewFieldName(meta));continue;}
        if(/勾选|同意|承诺书|用户协议|隐私声明/.test(meta.label||'')){element.fillNote='协议和承诺请本人确认';traceOutcomes.set(match.fieldId,{ok:false});continue;}
        element.recordContext=fields.filter(f=>f.group===meta.group&&f.recordIndex===meta.recordIndex).map(f=>({label:f.label,current:readBackValue(fieldMap.get(f.fieldId))})).slice(0,20);
        element.decide=observation=>decideInteraction(observation,aiConfig,button);
        if(meta.rangeId){
          const pair=fields.filter(f=>f.rangeId===meta.rangeId);
          const reason=rangeMatchReason(pair,allMatches);
          if(reason){element.fillNote=reason;traceOutcomes.set(match.fieldId,{ok:false});unfilledLabels.push(reviewFieldName(meta));continue;}
        }else if(/起止|起讫/.test(meta.label)){
          element.fillNote='未能明确日期区间的开始和结束，已停止';traceOutcomes.set(match.fieldId,{ok:false});unfilledLabels.push(reviewFieldName(meta));continue;
        }
        const readiness=await comboAgent.prepare(element);
        if(readiness.status==='SKIPPED'){
          const blockerName=readiness.blocker?.meta?reviewFieldName(readiness.blocker.meta):'前一控件';
          element.fillNote=`${blockerName}的弹层仍未收起，本字段局部跳过`;
          traceOutcomes.set(match.fieldId,{ok:false,notAttempted:true,isolated:true,blockedBy:blockerName,failureCode:readiness.code});
          locallySkippedLabels.push(reviewFieldName(meta));continue;
        }
        if(readiness.status==='BLOCKED'){
          const blockerName=readiness.blocker?.meta?reviewFieldName(readiness.blocker.meta):'未确认的页面弹层';
          for(const pending of sortedMatches.slice(sortedMatches.indexOf(match))){
            const pendingEntry=fieldMap.get(pending.fieldId),pendingMeta=fieldMetaMap.get(pending.fieldId);
            if(pendingEntry&&hasExistingValue(pendingEntry)){keptCount++;traceOutcomes.set(pending.fieldId,{ok:false,kept:true});continue;}
            if(pendingEntry)pendingEntry.fillNote=`页面状态不安全（${readiness.code}），本字段尚未尝试`;
            traceOutcomes.set(pending.fieldId,{ok:false,notAttempted:true,blockedBy:blockerName,failureCode:readiness.code});notAttemptedLabels.push(reviewFieldName(pendingMeta));
          }
          break;
        }
        let filled = element.kind==='combobox'?setElementValue(element,match.value)
          : (element.dateLike||element.pickerType)?fillDateWithAgent(element,match.value,meta):setElementValue(element, match.value);
        if (filled instanceof Promise) {
          filled = await filled;
        }
        // 日期写入会带出「简历只到月、按 1 号补的」这类说明，这里拆开。
        const writeResult = filled && typeof filled === "object" ? filled : { ok: Boolean(filled), padded: Boolean(element.datePadded) };
        filled = writeResult.ok;
        if (assisted && filled) {
          await new Promise(resolve => window.setTimeout(resolve, 50));
          filled = element.element.isConnected && element.element.value === match.value;
        }

        const fieldMeta = fieldMetaMap.get(match.fieldId);

        // 联动下拉的选项是上一级选完才异步加载的。没被识别成联动组、但除了「请选择」还没有选项的下拉框
        // 也按同样的方式等一等（和 worker 放行它用的是同一个判断）；选项出来了却对不上，不再白等。
        if (!filled && element.kind === "element" && element.element instanceof HTMLSelectElement
          && (fieldMeta?.cascadeGroup !== undefined || !hasRealSelectOptions(element.element))) {
          for (let retry = 0; retry < 12; retry++) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            element = refreshFieldEntry(fieldMeta, element);
            if (!element || hasExistingValue(element)) break;
            filled = setElementValue(element, match.value);
            if (filled || (fieldMeta?.cascadeGroup === undefined && hasRealSelectOptions(element.element))) break;
          }
        }

        if (filled) {
          if (writeResult.padded) {
            dateNotices.set(match.fieldId, "简历只写到月份，按 1 号填，请核对");
          }
          writtenEntries.set(match.fieldId, {
            entry: element,
            meta: fieldMeta,
            value: writeResult.value || match.value,
            inputType: fieldMeta?.inputType,
            mappingKey: match.mappingKey || "",
            label: fieldMeta?.label || fieldMeta?.placeholder || fieldMeta?.name || "未命名字段"
          });
          filledCount += 1;
          highlightFilledField(element, match.value);
        } else if (assisted) {
          unconfirmedCount += 1;
          traceOutcomes.set(match.fieldId, { ok: false, skipped: true });
        } else {
          unfilledLabels.push(fieldMeta?.label || fieldMeta?.placeholder || fieldMeta?.name || "未命名字段");
          traceOutcomes.set(match.fieldId, { ok: false });
        }

        if (filled && fieldMeta?.cascadeGroup !== undefined) {
          const groupFields = fields.filter((f) => f.cascadeGroup === fieldMeta.cascadeGroup);
          const maxLevelInGroup = Math.max(...groupFields.map((f) => f.cascadeLevel));
          
          if (fieldMeta.cascadeLevel < maxLevelInGroup) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }

      const verified = await verifyWrittenValues(writtenEntries, traceOutcomes,{focus:!notAttemptedLabels.length&&!locallySkippedLabels.length});
      writtenEntries.forEach((record, id) => fieldMap.set(id, record.entry));
      driftCount = verified.drift;
      filledCount = Math.max(0, filledCount - driftCount);
      swappedCount = verified.swapped;
      const manualNote = verified.manual.length
        ? `需核对：${summarizeLabels(verified.manual, 6)}。可展开“字段对照表”查看预期值与读回结果。`
        : "";
      const mappingOutcome = await applyMappingOutcomes(writtenEntries, traceOutcomes, platformSnapshot);
      mappingFilledCount = mappingOutcome.filled;
      // 写不进去的控件也要把类名线索带出来：用户不会去 F12 里抓 DOM，
      // 这些线索是下次能补上驱动的唯一依据。
      const controlHints = collectControlHints({ fields, fieldMap, outcomes: traceOutcomes, dropped: droppedControls });
      // Only enum codes and structural booleans/counts: never copy values,
      // option text, page IDs, URLs or provider errors into failure evidence.
      diagnostics.interactionFailures=self.ResumeProPopupController.sanitizeFailures(fields.flatMap(field=>{
        const entry=fieldMap.get(field.fieldId),result=entry?.interactionResult,out=traceOutcomes.get(field.fieldId);
        if(out?.ok||out?.kept||!result&&!out?.failureCode)return [];
        return [{fieldId:field.fieldId,status:out?.failureCode?(out.isolated?'SKIPPED':'BLOCKED'):result.status,
          code:out?.failureCode||result.code,observation:result?.observation,recovery:result?.recovery}];
      }));
      state.lastInteractionFailures=diagnostics.interactionFailures;
      // 这一轮没填上的控件，活引用只在本轮有效：自动点击采集要用，所以每次填写整体替换。
      state.lastCaptureTargets = buildCaptureTargets({ fields, fieldMap, outcomes: traceOutcomes });
      traceText = formatFieldTrace({ fields, fieldMap, matches: allMatches, outcomes: traceOutcomes, unlabeledCombos, notices: dateNotices, dropped: controlHints.list, droppedTotal: controlHints.total });
      // 快照要带上每个字段实际的写入结果，所以放在复读校验之后。
      structureText = await recordStructureSnapshot({ fields, fieldMap, outcomes: traceOutcomes, unlabeledCombos, dropped: controlHints.list, droppedTotal: controlHints.total });
      // 这次填对的位置当场记成映射：下次同一套表单照映射直接填，不用再问模型。
      const learnedMappings = await learnMappingsFromFill({ fields, written: writtenEntries, outcomes: traceOutcomes, matches: allMatches });
      learnedNote = learnedMappings
        ? `记下 ${learnedMappings} 条平台映射，下次这套表单直接照映射填。`
        : "";
      const answered = new Set(allMatches.map(match => match.fieldId));
      const blockedFields = fields.filter(field => field.sourceRejection && !answered.has(field.fieldId));
      const sourceNote = blockedFields.length
        ? `${blockedFields.length} 项被来源校验拦截，未写入；请查看字段对照表中的原因。`
        : "";
      outcome = response.warning || unconfirmedCount || unfilledLabels.length || notAttemptedLabels.length || locallySkippedLabels.length || driftCount || blockedFields.length ? "partial" : "success";
      const driftNote = driftCount
        ? `${driftCount} 项未通过页面读回校验${swappedCount ? `（其中 ${swappedCount} 项可能与其他字段串值）` : ""}，已标红可定位的控件，请核对后再提交。`
        : "";
      const unfilledNote = (unfilledLabels.length
        ? `${unfilledLabels.length} 项没填上：${summarizeLabels(unfilledLabels)}，请手动补上。`
        : "")+(locallySkippedLabels.length?`${locallySkippedLabels.length} 项因局部弹层跳过，收起弹层后可补填。`:"")
        +(notAttemptedLabels.length?`${notAttemptedLabels.length} 项尚未尝试：无法确认页面操作安全，请收起弹层后重新填写。`:"");
      const mappingNote = mappingFilledCount
        ? `其中 ${mappingFilledCount} 项按这套平台的快照映射直接填，未请求 AI${aiFields.length ? `（只把剩下 ${aiFields.length} 个字段送去匹配）` : "（本次没有字段发出去）"}。`
        : "";
      const droppedNote = mappingOutcome.dropped.length
        ? `${mappingOutcome.dropped.length} 条映射连续落空已删除，这些位置下次回落 AI：${summarizeLabels(mappingOutcome.dropped)}。`
        : "";
      const keptNote = keptCount
        ? `${keptCount} 项页面上已经有内容，按你的设置未改动。`
        : "";
      if (assisted) {
        showStatus(`辅助填写：已验证 ${filledCount} 项。${unconfirmedCount ? `${unconfirmedCount} 项未确认，请核对网页。` : ""}${sourceNote}${response.warning || ""}`, outcome === "partial" ? "error" : "success");
      } else if (response.warning) {
        showStatus(`本地已填写 ${filledCount} 项；${unfilledNote}${driftNote}${sourceNote}${response.warning}`, "error", Boolean(unfilledNote || driftNote || sourceNote));
      } else if (unfilledNote || driftNote || manualNote || sourceNote) {
        // 没填上的字段要用户自己去补，提示不自动消失。
        showStatus(`已填写 ${filledCount} 个字段。${unfilledNote}${driftNote}${manualNote}${sourceNote}${learnedNote}`, "error", true);
      } else if (mappingNote || droppedNote || keptNote || learnedNote) {
        showStatus(`已填写 ${filledCount} 个字段。${mappingNote}${keptNote}${learnedNote}${droppedNote}`, "success", true);
      } else {
        showStatus(`已填写 ${filledCount} 个字段。`, "success");
      }

      if (!assisted) {
        const matchedIds = new Set(allMatches.map((match) => match.fieldId));
        offerUnansweredFields(fields.map((field) => ({
          label: field.label || field.placeholder || field.name,
          inputType: field.inputType,
          matched: matchedIds.has(field.fieldId),
          hasValue: hasExistingValue(fieldMap.get(field.fieldId)),
          entry: fieldMap.get(field.fieldId)
        })), resumeFields);
      }
    } catch (error) {
      if (!diagnostics.errorCode || diagnostics.errorCode === 'none') diagnostics.errorCode = safeInputErrorCode(error.code) || 'unknown';
      showStatus(error.message || "AI 填写失败。", "error");
    } finally {
      comboAgent.suspend();
      if (cancelButton) {
        cancelButton.hidden = true;
        cancelButton.onclick = null;
      }
      if (waitHint) waitHint.hidden = true;
      if (timer !== null) window.clearInterval(timer);
      if (phase) timing[phase] = performance.now() - phaseStart;
      const totalMs = performance.now() - totalStart;
      const summary = formatFillDiagnostics({ ...timing, totalMs,
        fieldCount, filledCount, unfilledCount: unfilledLabels.length, notAttemptedCount:notAttemptedLabels.length, locallySkippedCount:locallySkippedLabels.length, outcome, stage, diagnostics });
      const panel = shadowRoot?.querySelector("#resume-pro-diagnostics");
      const text = shadowRoot?.querySelector("#resume-pro-diagnostics-text");
      if (panel && text) {
        text.value = summary;
        panel.hidden = false;
        panel.open = true;
      }
      const tracePanel = shadowRoot?.querySelector("#resume-pro-trace");
      const traceArea = shadowRoot?.querySelector("#resume-pro-trace-text");
      if (tracePanel && traceArea) {
        traceArea.value = traceText;
        tracePanel.hidden = !traceText;
        tracePanel.open = false;
      }
      const structurePanel = shadowRoot?.querySelector("#resume-pro-structures");
      const structureArea = shadowRoot?.querySelector("#resume-pro-structures-text");
      if (structurePanel && structureArea) {
        structureArea.value = structureText;
        structurePanel.hidden = !structureText;
        structurePanel.open = false;
      }
      button.disabled = false;
      if (repeatButton) repeatButton.disabled = false;
      if (collectButton) collectButton.disabled = false;
      button.textContent = "一键 AI 填写";
      // A page with nothing to fill produced nothing worth archiving.
      if (fieldCount > 0) {
        offerFillRecord({
          outcome, cancelled: cancelRequested, fieldCount, filledCount, unconfirmedCount,
          timing: { scanMs: timing.scanMs, roundTripMs: timing.roundTripMs, fillMs: timing.fillMs, totalMs },
          templateName: activeTemplate?.name,
          endedAt: new Date().toISOString()
        }, activeTemplate).catch(() => {});
      }
    }
  }

  function summarizeLabels(labels, limit = 5) {
    const unique = [...new Set(labels.map((label) => String(label ?? "").trim()).filter(Boolean))];
    const shown = unique.slice(0, limit).join("、");
    return unique.length > limit ? `${shown} 等` : shown;
  }

  const DROP_REASON_LABEL = {
    "combo-no-label": "下拉取不到标签",
    "label-was-value": "标签位置上显示的是值",
    "label-is-placeholder": "标签退化成了占位符",
    "no-label": "没有任何标签线索",
    "write-rejected": "写了但页面没认"
  };

  function formatFieldTrace({ fields, fieldMap, matches, outcomes, unlabeledCombos = 0, notices = null, dropped = null, droppedTotal = 0 }) {
    const byId = new Map(matches.map((match) => [match.fieldId, match]));
    const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    const groupOf = (field) => {
      const entry = fieldMap?.get(field.fieldId);
      const anchor = entry?.kind === "radio" ? entry.elements?.[0] : entry?.kind === "combobox" ? entry.root : entry?.element;
      return field.group || findSectionHeading(anchor);
    };
    const sourceOf = (match) => {
      const key = oneLine(match.resumeKey) || "未知";
      if (match.source === "local" && !match.relation) return `简历字段「${key}」`;
      if (match.invented) return "简历里找不到出处";
      if (match.relation === 'date-part') return `按${{year:'年',month:'月',day:'日'}[fields.find(field=>field.fieldId===match.fieldId)?.datePart]||'日期部分'}取自简历字段「${key}」`;
      if (match.relation === "date") return `简历字段「${key}」的另一种写法`;
      if (match.relation === "formatted") return `格式化自简历字段「${key}」`;
      if (match.relation === "equivalent") return `简历字段「${key}」的同义写法`;
      if (match.relation === "inferred") return `依据简历字段「${key}」推导（${oneLine(match.inference?.inputLabel)}：${oneLine(match.inference?.inputValue)} → ${oneLine(match.inference?.targetValue)}）`;
      if (match.relation === "partial") return `截自简历字段「${key}」`;
      if (match.relation === "rewritten") return `按简历字段「${key}」改写`;
      if (match.relation === "composed") return `组合自简历字段「${key}」`;
      return `简历字段「${key}」${match.ambiguousSource ? " 等多条同值" : ""}`;
    };
    const rows = [];
    const swapped = [];
    const kept = [];
    const silent = [];
    const invented = [];
    const blocked = [];
    const missing = [];
    const failed = [];
    const notAttempted = [];
    const locallySkipped = [];
    let localCount = 0;
    let mappingCount = 0;
    let aiCount = 0;

    fields.forEach((field) => {
      const group = groupOf(field);
      const title = reviewFieldName({...field, group:group || field.group});
      const match = byId.get(field.fieldId);
      const prefetchError = fieldMap?.get(field.fieldId)?.prefetchError;
      if (prefetchError) rows.push(`${title} · 选项预读未完成（${oneLine(prefetchError)}）`);

      if (!match) {
        (field.sourceRejection ? blocked : missing).push(title);
        const rejected = field.sourceRejection ? `来源校验拦截（${field.sourceRejection}）` : "没给出值";
        const proposed = field.sourceRejectionValue ? ` · 预期值：${oneLine(field.sourceRejectionValue)}` : "";
        rows.push(`${title} → ${rejected}${proposed}`);
        return;
      }

      if (match.source === "mapping") mappingCount += 1;
      else if (match.source === "local") localCount += 1;
      else aiCount += 1;
      const outcome = outcomes.get(field.fieldId);
      let result;

      if (!outcome) { result = "尚未尝试"; notAttempted.push(title); }
      else if (outcome.notAttempted&&outcome.isolated) {result=`局部跳过（${oneLine(outcome.blockedBy)||'前一控件'}的弹层未关闭）`;locallySkipped.push(title);}
      else if (outcome.notAttempted) {result=`尚未尝试（页面操作安全检查未通过：${outcome.failureCode||'POPUP_CLOSE_UNCONFIRMED'}）`;notAttempted.push(title);}
      else if (outcome.kept) {
        result = "页面上已有内容，按规则未改动";
        kept.push(title);
      } else if (outcome.ok) result = "已写入";
      else if (outcome.skipped) result = "跳过（辅助模式只填空字段）";
      else if (outcome.swappedWith) {
        result = `值是别的行串过来的（当前显示：${oneLine(outcome.readBack) || "空"}，本该填「${outcome.swappedWith}」）`;
        swapped.push(title);
      } else if (typeof outcome.readBack === "string") {
        result = `${outcome.failureReason || "未通过读回校验"}（当前显示：${oneLine(outcome.readBack) || "空"}）`;
        silent.push(title);
      } else {
        const entry = fieldMap?.get(field.fieldId), note = entry?.fillNote;
        result = entry?.fillIssue === 'choice-mismatch' ? `需要人工选择（${String(note || '').slice(0,240)}）`
          : note ? `没写进去（${oneLine(note)}）` : "没写进去（控件不收）";
        failed.push(title);
      }

      if (match.invented) {
        invented.push(title);
      }

      const actions = fieldMap?.get(field.fieldId)?.interactions;
      if (actions?.length) rows.push(`${title} · 操作：${actions.map(item => item.action + (item.detail ? `（${item.detail}）` : "")).join(" → ")}`);
      const transaction=fieldMap?.get(field.fieldId)?.interactionResult;
      if(transaction&&!outcome?.ok&&!outcome?.kept)rows.push(`${title} · 交互结果：${transaction.status} / ${transaction.code}；状态 ${transaction.observation.state}；面板候选 ${transaction.observation.popupCandidates}`);
      const notice = notices?.get(field.fieldId);
      rows.push(`${title} → ${result} · ${match.source === "local" ? "规则补空" : (match.source === "mapping" ? "快照映射" : "AI")} · ${sourceOf(match)} = ${oneLine(match.value) || "空"}${notice ? `（${notice}）` : ""}`);
    });

    const notes = [];
    if (kept.length) notes.push(`${kept.length} 个字段页面上已经有内容，按你的设置未改动（${kept.slice(0, 6).join("、")}）`);
    if (swapped.length) notes.push(`${swapped.length} 个字段的值是别的行串过来的（${swapped.slice(0, 6).join("、")}）—— 提交前必须逐个核对`);
    if (silent.length) notes.push(`${silent.length} 个字段未通过读回校验（${silent.slice(0, 6).join("、")}）`);
    if (invented.length) notes.push(`${invented.length} 个字段的值在简历里找不到出处（${invented.slice(0, 6).join("、")}）`);
    if (blocked.length) notes.push(`${blocked.length} 个字段被来源校验拦截，未写入（${blocked.slice(0, 6).join("、")}），原因见明细`);
    if (failed.length) notes.push(`${failed.length} 个字段未完成填写（${failed.slice(0, 6).join("、")}）`);
    if (locallySkipped.length) notes.push(`${locallySkipped.length} 个字段因局部弹层跳过（${locallySkipped.slice(0,6).join('、')}），已继续检查其他字段`);
    if (notAttempted.length) {
      const blockers=[...new Set(fields.map(f=>outcomes.get(f.fieldId)?.blockedBy).filter(Boolean))];
      notes.push(`${notAttempted.length} 个字段尚未尝试${blockers.length?`（${blockers.slice(0,2).join('、')}的弹层未关闭，收起后重试）`:'，本轮未执行到写入'}`);
    }
    if (unlabeledCombos && !droppedTotal) notes.push(`另有 ${unlabeledCombos} 个自定义下拉取不到标签，没送去匹配，需要手动填`);
    if (droppedTotal) {
      const hints = (dropped || []).slice(0, 6).map((item) => {
        const what = [DROP_REASON_LABEL[item.reason] || item.reason, item.label, item.control]
          .filter(Boolean).join(" · ");
        const hint = String(item.hint || "").slice(0, 120);
        return `${item.count > 1 ? `${what} ×${item.count}` : what}（${hint}）`;
      });
      notes.push(`${droppedTotal} 个控件要补驱动或补标签，类名线索：${hints.join("；")}`);
    }

    const families = new Map();
    fields.forEach(field => {if(field.controlFamily)families.set(field.controlFamily,(families.get(field.controlFamily)||0)+1);});
    const familyNames = Array.from(families,([id,count]) => `${self.ResumeProControlCatalog.contracts.find(c=>c.id===id)?.name || id} ×${count}`);
    return [
      `ApplyFill v${pluginVersion()} · 字段对照表`,
      `扫描 ${fields.length} 个字段，给出值 ${byId.size} 个（AI ${aiCount}、规则补空 ${localCount}、快照映射 ${mappingCount}）。`,
      ...(missing.length ? [`另有 ${missing.length} 个字段未给出值，需核对资料是否齐全。`] : []),
      ...(familyNames.length ? [`识别控件：${familyNames.join("、")}。`] : []),
      notes.length ? `需要注意：${notes.join("；")}。` : "已写入的字段未发现串位或读回失败。",
      "",
      ...rows
    ].join("\n");
  }

  // --- 平台结构快照：只记「这个平台的表单长什么样、控件要怎么驱动、选项有哪些」，
  // 不记用户填进去的任何内容。标签和选项都是平台定义的，跨公司稳定，也不含个人信息。
  const FORM_VENDOR_SELECTOR = "[class*='moka'],[class*='beisen'],[class*='italent'],[class*='hotjob'],[class*='sapsf'],[class*='workday'],[class*='nowcoder'],[class*='kincere'],[class*='yonyou'],[class*='hrcloud'],[class*='dayi'],[id*='moka'],[id*='beisen']";

  function pageStructureSignals() {
    const signals = [
      location.hostname,
      document.body?.className,
      document.documentElement?.className,
      document.documentElement?.id,
      document.body?.id
    ];

    Array.from(document.querySelectorAll("script[src]")).slice(0, 120).forEach((element) => {
      signals.push(element.getAttribute("src") || "");
    });
    Array.from(document.querySelectorAll(FORM_VENDOR_SELECTOR)).slice(0, 40).forEach((element) => {
      signals.push(`${element.tagName} ${element.getAttribute("class") || ""} ${element.getAttribute("id") || ""}`);
    });

    return signals.filter(Boolean).map(String);
  }

  function formControlOf(entry, field) {
    if (entry?.kind === "combobox") return "combobox";
    if (field.inputType === "date-picker") return "date-picker";
    if (field.inputType === "select") return "select";
    if (field.inputType === "radio") return "radio";
    if (field.inputType === "checkbox") return "checkbox";
    if (field.tagName === "textarea") return "textarea";
    return field.tagName === "input" ? `input:${field.inputType || "text"}` : String(field.tagName || "unknown");
  }

  // 驱动方式才是这次真正攒下来的东西：同一个「学历」下拉，A 公司能直接赋值、
  // B 公司必须点开再选；记下来下次就不用再试错。
  function formDriveOf(entry, field) {
    if (entry?.atsxPeriod || entry?.interactions?.some(item => /识别.*日历/.test(item.action))) return "open-calendar-pick";
    if (entry?.kind === "combobox") return entry.remoteOptions ? "open-search-pick" : "open-pick";
    if (field.inputType === "date-picker" && self.ResumeProControlCatalog.contracts.some(c=>c.id===field.controlFamily && c.driver==='calendar-panel')) return "open-calendar-pick";
    if (field.inputType === "date-picker") return "click-focus-type-enter";
    if (entry?.dateLike) return "focus-type-enter";
    if (field.cascadeGroup !== undefined) return "cascade-select";
    if (field.inputType === "select") return "native-option";
    if (field.inputType === "radio") return "native-radio";
    if (field.inputType === "checkbox") return "native-checkbox";
    if (["date", "month", "time", "datetime-local"].includes(field.inputType)) return "native-keyboard";
    if (field.tagName === "input" || field.tagName === "textarea") return "native-setter";
    return "unknown";
  }

  function captureFormStructure({ fields, fieldMap, outcomes, unlabeledCombos, dropped = null, droppedTotal = 0 }) {
    const api = self.ResumeProFormStructure;
    if (!api) {
      return null;
    }

    // 可搜索的组合框点开显示的是你自己的历史记录（毕业院校这类），不是平台词表；
    // 混进快照既泄露又不该被复用。民族那种 56 项的平台词表不受影响。
    const filled = new Set();
    fields.forEach((field) => {
      const value = readFieldValue(fieldMap.get(field.fieldId), field);
      if (value && value.length <= 40) {
        filled.add(value);
      }
    });

    return {
      version: 2,
      platform: api.detectPlatform(pageStructureSignals()),
      seenAt: new Date().toISOString().slice(0, 10),
      origins: [location.origin],
      unlabeledCombos: unlabeledCombos || 0,
      // 认不出来的控件：只留类名 / role / type，不留任何填写内容。
      // 导出的结构文件里能直接看出下次该补哪个选择器。
      unrecognized: (Array.isArray(dropped) ? dropped : []).slice(0, 20),
      unrecognizedTotal: droppedTotal || (Array.isArray(dropped) ? dropped.length : 0),
      fields: fields.map((field) => {
        const entry = fieldMap.get(field.fieldId);
        const outcome = outcomes.get(field.fieldId);
        const options = (entry?.observedOptions?.length ? entry.observedOptions : field.options || [])
          .filter((option) => !filled.has(String(option).trim()));

        return {
          group: field.group || "",
          label: field.label || "",
          // __radio__N 是扫描时给没有 name 的单选临时编的占位，跟页面位置绑定、跨公司无意义，
          // 当成结构标识会把映射带偏。
          name: /^__radio__\d+$/.test(field.name || "") ? "" : (field.name || ""),
          id: api.maskIdentifier(field.idAttr),
          placeholder: field.label ? "" : sanitizeLabelText(field.placeholder || "").slice(0, 24),
          control: formControlOf(entry, field),
          controlFamily: field.controlFamily || "",
          controlEvidence: field.controlEvidence || "",
          drive: formDriveOf(entry, field),
          options: options.slice(0, 60).map((option) => String(option).slice(0, 40)),
          recordIndex: field.recordIndex,
          recordTotal: field.recordTotal,
          datePart: field.datePart,
          rangeRole: field.rangeRole,
          result: outcome?.ok ? "ok" : outcome ? "failed" : "untested"
        };
      }).filter((field) => field.label || field.name || field.id || field.placeholder)
    };
  }

  async function recordStructureSnapshot(context) {
    try {
      const api = self.ResumeProFormStructure;
      const snapshot = captureFormStructure(context);
      if (!api || !snapshot?.fields.length) {
        return "";
      }

      const merged = await StorageService.recordFormStructure(snapshot);
      return api.serialize(merged?.list || []);
    } catch (_) {
      // 附属能力：结构快照存失败不能把一次成功的填写报成失败。
      return "";
    }
  }

  async function loadPlatformSnapshot() {
    const api = self.ResumeProFormStructure;
    if (!api) {
      return null;
    }

    const platform = api.detectPlatform(pageStructureSignals());
    // 认不出平台就不照映射填：两个 unknown 之间会互相误配，那比不填更糟。
    if (platform === "unknown") {
      return null;
    }

    try {
      const stored = await chrome.storage.local.get(["formStructures"]);
      const list = (Array.isArray(stored.formStructures) ? stored.formStructures : [])
        .filter((item) => item?.version === 2 && item.platform === platform);
      if (list[0]) {
        return api.upgradeMappings ? api.upgradeMappings(list[0]) : list[0];
      }
      // Offline option seeds are not evidence of this employer's current vocabulary.
      return null;
    } catch (_) {
      return null;
    }
  }

  function mappingMatches({ fields, snapshot, resumeFields }) {
    const api = self.ResumeProFormStructure;
    const helpers = self.ResumeProAIHelpers;
    const matches = [];
    const answered = new Set();

    if (!api || !snapshot) {
      return { matches, answered };
    }

    fields.forEach((field) => {
      if (fields.filter(candidate => api.fieldIdentity(candidate) === api.fieldIdentity(field)).length !== 1) return;
      const hit = api.lookupMapping(snapshot, {
        label: field.label,
        group: field.group || "",
        recordIndex: field.recordIndex,
        groupSignature: field.recordSignature,
        datePart: field.datePart
      });
      if (!hit) {
        return;
      }

      const source = api.resolveMappingSource(hit, resumeFields);
      if (!source || !String(source.value ?? "").trim()) {
        // 模板里把这条删了，或者那条还没填内容 —— 回落 AI，别拿空值去写。
        return;
      }
      if (helpers?.educationFieldTopic(field)) {
        const proof=helpers.findResumeSource(source.value, [source], field);
        // Old mappings store a source field, not the proof binding this education
        // row. A degree conversion goes through the fresh record-aware pipeline.
        if (proof.relation === 'none' || proof.relation === 'inferred') return;
        // A global highest level needs fresh evidence about this row, which a cached mapping lacks.
        if (/教育/.test(field.group || '') && !/教育/.test(source.group || '')) return;
      }
      if (helpers?.isValueValidForField && !helpers.isValueValidForField(field, source.value)) {
        return;
      }

      matches.push({
        fieldId: field.fieldId,
        value: source.value,
        source: "mapping",
        resumeKey: hit.resumeKey,
        mappingKey: api.fieldIdentity(field)
      });
      answered.add(field.fieldId);
    });

    return { matches, answered };
  }

  // 复用映射填的字段，按读回结果给这条映射记一次命中或落空；连续落空满三次就删掉它，
  // 下次自动回落 AI。段签名对不上的位置根本没走映射，不会被误记成落空。
  async function applyMappingOutcomes(written, outcomes, snapshot) {
    const api = self.ResumeProFormStructure;
    if (!api || !snapshot) {
      return { filled: 0, dropped: [] };
    }

    let filled = 0;
    const dropped = [];
    let touched = false;

    written.forEach((record, fieldId) => {
      if (!record.mappingKey) {
        return;
      }

      const ok = Boolean(outcomes.get(fieldId)?.ok);
      if (ok) {
        filled += 1;
      }
      touched = true;

      const result = api.recordMappingOutcome(snapshot, record.mappingKey, ok);
      if (result.dropped) {
        dropped.push(`${result.label}（原本对应「${result.resumeKey}」）`);
      }
    });

    if (touched) {
      await StorageService.replaceFormStructure(snapshot);
    }

    return { filled, dropped };
  }

  // 映射不再只有点「采集」才学。这次填对的位置本身就说明了「这个平台的这个标签
  // 对应模板里的哪一条」，当场记下来，下次同一套表单照映射直接填，不用再问模型。
  // 只记复读通过、出处唯一的：写进去被页面顶掉的位置对应关系还不可信，
  // 模型编的值和「一条值对上好几个键」的更会把映射带偏。
  async function learnMappingsFromFill({ fields, written, outcomes, matches }) {
    const api = self.ResumeProFormStructure;
    if (!api) {
      return 0;
    }

    const byId = new Map((matches || []).map((match) => [match.fieldId, match]));
    const entries = [];

    (fields || []).forEach((field) => {
      if (!outcomes?.get(field.fieldId)?.ok || !written?.has(field.fieldId)) {
        return;
      }
      if (!api.normalizeLabel(field.label)) {
        return;
      }

      if (fields.filter(candidate => api.fieldIdentity(candidate) === api.fieldIdentity(field)).length !== 1) return;
      const match = byId.get(field.fieldId);
      if (!match?.resumeKey || match.source === "mapping" || match.invented || match.ambiguousSource) {
        return;
      }
      if (String(match.resumeKey).includes("、")) {
        return;
      }
      if (self.ResumeProAIHelpers?.educationFieldTopic(field) && /教育/.test(field.group || '')
        && !/教育/.test(match.resumeGroup || '')) return;
      // 只学「原样相等」和「日期的另一种写法」两档。映射只存字段名，复现不了模型
      // 当时做的加工：截取（英语水平 → 英语）学下来，下次就会把整段原文写进那一格；
      // 本地规则的宽松匹配（id 里带 name 就当成人名）学下来，会把姓名写进项目名称。
      if (match.relation !== "exact" && match.relation !== "date") {
        return;
      }

      entries.push({
        label: field.label,
        group: field.group || "",
        recordIndex: Number.isInteger(field.recordIndex) ? field.recordIndex : 0,
        recordTotal: field.recordTotal || 0,
        groupSignature: field.recordSignature || "",
        resumeKey: match.resumeKey,
        resumeGroup: match.resumeGroup || "",
        resumeGroupId: match.resumeGroupId || "",
        resumeRecordId: match.resumeRecordId || "",
        resumeFieldId: match.resumeFieldId || ""
      });
    });

    if (!entries.length) {
      return 0;
    }

    // 快照刚刚被这一次的结构记录合并过，要重新读，不能拿跑之前那份去覆盖。
    const snapshot = await loadPlatformSnapshot();
    if (!snapshot) {
      return 0;
    }

    const applied = api.applyMappingEntries(snapshot, entries);
    if (!applied.changed) {
      return 0;
    }

    await StorageService.replaceFormStructure(applied.snapshot);
    return entries.length;
  }

  function safeInputErrorCode(code) {
    return /^input_(?:invalid|too_long|target_(?:missing|ambiguous|disabled|moving|hidden|covered)|observation|focus|context|busy|foreground|page_changed|attach|transport)$/.test(code || '') ? code : '';
  }

  function formatFillDiagnostics(result) {
    const seconds = (value) => typeof value === "number" && Number.isFinite(value) ? `${(value / 1000).toFixed(2)} s` : "未执行 / 未取得";
    const count = (value) => Number.isInteger(value) && value >= 0 ? value : "未取得";
    const d = result.diagnostics;
    const interactionFailures=self.ResumeProPopupController.sanitizeFailures(d.interactionFailures);
    // Explicit allowlist: never copy provider messages, URL, keys or field values.
    const code = /^(none|cancelled|network|format|http_\d{3})$/.test(d.errorCode) ? d.errorCode : safeInputErrorCode(d.errorCode) || "unknown";
    const stage = ({scan:'扫描',options:'读取控件选项',match:'AI 匹配',fill:'填写与核对'})[result.stage] || '未取得';
    return [
      `ApplyFill v${pluginVersion()}`,
      `结果：${({ success: "完成", partial: "部分完成", failed: "失败" })[result.outcome] || "未知"}；错误类别：${code}`,
      `中断阶段：${result.outcome === 'failed' ? stage : '无'}`,
      `网页字段：${count(result.fieldCount)}；成功填写：${count(result.filledCount)}；没填上：${count(result.unfilledCount)}`,
      ...(result.notAttemptedCount?[`尚未尝试：${count(result.notAttemptedCount)}（前一控件弹层未关闭）`]:[]),
      ...(result.locallySkippedCount?[`局部跳过：${count(result.locallySkippedCount)}（其他可安全操作的字段继续）`]:[]),
      `AI 匹配：${count(d.aiMatches)}；规则补空：${count(d.ruleMatches)}；来源校验拦截：${count(d.rejectedSources)}`,
      `送 AI 字段：${count(d.aiFields)}（全部网页字段）`,
      `候选 / 简历字段：${count(d.candidateFields)} / ${count(d.resumeFields)}`,
      `用户 prompt：${count(d.promptBytes)} bytes`,
      `扫描：${seconds(result.scanMs)}`,
      d.optionMode==='on-demand'?`候选选项：填写时按需读取；扫描已展开列表 ${count(d.optionObserved)}；主动预读 0`
        :`选项预读：${seconds(result.optionsMs)}；尝试 ${count(d.optionAttempts)}；读到选项 ${count(d.optionObserved)}；失败 ${count(d.optionFailures)}`,
      ...(d.optionFailures ? [`预读错误：${[...new Set(d.optionErrors || [])].map(c=>safeInputErrorCode(c)||'unknown').join('、')}`] : []),
      `匹配往返（含后台处理）：${seconds(result.roundTripMs)}`,
      `API（含响应读取）：${seconds(d.apiMs)}`,
      `填写：${seconds(result.fillMs)}；总计：${seconds(result.totalMs)}`,
      ...(interactionFailures.length?[`交互失败证据（无资料值）：${JSON.stringify(interactionFailures)}`]:[])
    ].join("\n");
  }

  // 自定义下拉（Ant / Element / Fusion / Arco / Semi / MUI 这类 div 拼出来的组合框）。
  // 页面里没有原生 input/select，旧扫描完全看不见它们。
  // 飞书 ATS 用的是 Ant Design 3.x 的换皮版：类名前缀从 ant- 换成 atsx-
  // （实测到 atsx-select-selection--single、atsx-select-lg、atsx-date-picker-period-month、
  // atsx-form-item）。结构、状态类名、日历面板完全一样，所以选择器按前缀展开，
  // 别一处一处补 —— 漏一处就是整类控件失效（飞书的下拉和日期就是这么整类漏掉的）。
  const ANTD_SKINS = ["ant", "atsx"];
  const skin = (...selectors) => ANTD_SKINS
    .flatMap((prefix) => selectors.map((selector) => selector.replace(/\.ant-/g, `.${prefix}-`)))
    .join(", ");
  const controlCatalog = self.ResumeProControlCatalog;

  const COMBO_ROOT_SELECTOR = `${controlCatalog.selector('selectRoot')}, .next-select, .arco-select, .semi-select, .MuiSelect-root, [role='combobox']`;
  // 组件库的最外层容器：一层套一层时取最外那个，免得同一个下拉被扫成两个字段。
  const COMBO_LIBRARY_SELECTOR = `${controlCatalog.selector('selectRoot')}, .next-select, .arco-select, .semi-select, .MuiSelect-root`;
  // ant 3.x 的触发器是 .ant-select-selection，4.x 才是 -selector，两个都要认。
  const COMBO_TRIGGER_SELECTOR = `${controlCatalog.selector('trigger')}, .next-select-inner, .arco-select-view, .semi-select-selection, .MuiSelect-select, [role='combobox']`;
  function comboTriggerFor(root) {
    // Phoenix Select.tsx owns onClick on the .phoenix-select wrapper; __inputWrapper can be a tiny
    // placeholder covered by sibling display layers, not the activation surface.
    return (root.matches('.ud__select') ? root.querySelector('.ud__select__selector') || root.querySelector('.ud__select__dropdown-open input') || root : null)
      || (root.matches('.phoenix-select') ? root : root.matches('.phoenix-select__cont') ? root.querySelector('.phoenix-select') || root : null)
      || root.querySelector(COMBO_TRIGGER_SELECTOR) || root;
  }
  const COMBO_OPTION_SELECTOR = `${controlCatalog.selector('option')}, .next-menu-item, .arco-select-option, .semi-select-option, .MuiMenuItem-root, [role='treeitem'], [class*='phoenix-select'][class*='option']`;
  const COMBO_DISPLAY_SELECTOR = `${controlCatalog.selector('display')}, .next-select-values, .arco-select-view-value, .semi-selection-item-text, .MuiSelect-select, [class*='selectedValue']`;
  // Popup search boxes are observations/actions within a control, not resume fields.
  const CONTROL_POPUP_SELECTOR = `${controlCatalog.selector('selectPanel')}, ${controlCatalog.selector('datePanel')}`;
  function controlPopupFor(node) {
    const panel = node.closest(CONTROL_POPUP_SELECTOR);
    if (panel) return controlCatalog.popupRoot(panel);
    // Search inputs can be siblings of the option list in a real, bounded popup.
    const layer = node.closest(controlCatalog.selector('layerRoot'));
    return layer && Array.from(layer.querySelectorAll(CONTROL_POPUP_SELECTOR)).some(p => controlCatalog.popupRoot(p) === layer) ? layer : null;
  }
  // 真实站点上的占位语常带字段名（「请选择民族」），只认完整匹配会把它当成已有内容。
  // 前缀匹配挡的是「请选择…」「请输入…」这类；「选择其他」这种正经选项不以「请」开头，不受影响。
  const COMBO_PLACEHOLDER = /^(请选择|请输入|请填写|不限|--|—|…|please\s*(select|choose)|select\b|choose\b)/i;

  const comboAgent = self.ResumeProComboAgent.create({
    visible:isVisible, optionSelector:COMBO_OPTION_SELECTOR, displaySelector:COMBO_DISPLAY_SELECTOR,
    panelSelector:`${controlCatalog.selector('selectPanel')}, [role='tree'], [class*='select-dropdown' i], [class*='select__dropdown' i], [class*='select__menu' i], [class*='select__list' i], [class*='autocomplete' i][class*='dropdown' i], [class*='select' i][class*='options' i], [class*='select' i][class*='menu' i], [class*='select' i][class*='list' i]`,
    placeholder:isFormatPlaceholder,
    popupRoot:controlCatalog.popupRoot,
    click:node=>browserInputEnabled()?browserInput(node):null,
    input:(node,text)=>browserInputEnabled()?browserInput(node,text):null,
    escape:node=>browserInputEnabled()?browserEscape(node):null,
    dismiss:node=>browserInputEnabled()?browserAction(controlCatalog.dismissSurface(node)||node,{kind:'dismiss'}):null,
    readPeer:entry=>readBackValue(entry),
    refresh:entry=>entry.meta?refreshFieldEntry(entry.meta,entry):null
  });

  function visibleComboOptions() {
    return Array.from(document.querySelectorAll(COMBO_OPTION_SELECTOR))
      .filter((option) => isVisible(option) && !option.closest(`#${SIDEBAR_ID}`) && !option.closest("[aria-hidden='true']"));
  }

  const STRUCTURAL_CHOICE_PANELS = '[role="listbox"],ul,[class*="dropdown" i],[class*="suggest" i],[class*="options" i],[class*="menu" i],[class*="list" i]';
  const provenChoiceRoots=new WeakSet();
  function structuralChoiceRoot(input,previouslyProven=false) {
    if (!(input instanceof HTMLInputElement) || !['text','search'].includes(input.type)
      || input.list || input.closest(`#${SIDEBAR_ID}`) || controlPopupFor(input)) return null;
    const label=getFieldLabel(input),placeholder=input.getAttribute('placeholder')||'';
    if(looksLikeDateInput(input,label,placeholder)||input.closest('[class*="picker" i],[class*="calendar" i]'))return null;
    let owner=null;
    for(let scope=input.parentElement,depth=0;scope&&depth<4;scope=scope.parentElement,depth++){
      if(scope.matches('body,form,main,section,fieldset,nav'))break;
      const controls=Array.from(scope.querySelectorAll('input:not([type="hidden"]),textarea,select'))
        .filter(n=>isVisible(n)&&!n.matches('[type="checkbox"],[type="radio"]'));
      if(controls.length!==1||controls[0]!==input)break;
      const named=/(?:^|[-_\s])(?:select\d*|autocomplete|auto-complete|autosuggest|dropdown|combobox|combo)(?:[-_\s]|$)/i.test(String(scope.className||''));
      const linked=input.matches('[aria-haspopup="listbox"],[aria-autocomplete="list"],[aria-autocomplete="both"]');
      const list=Array.from(scope.querySelectorAll(STRUCTURAL_CHOICE_PANELS)).some(n=>!n.contains(input)
        &&!n.querySelector('input,textarea,select,form')&&(n.matches('[role="listbox"]')||['absolute','fixed'].includes(getComputedStyle(n).position)));
      const arrow=input.readOnly&&scope.querySelector('[class*="arrow" i],[class*="caret" i],[class*="chevron" i]');
      if((named||!owner&&(linked||list||arrow||provenChoiceRoots.has(scope)||previouslyProven&&input.value.trim()))&&(formItemLabel(scope,'')||getFieldLabel(input)))owner=scope;
    }
    // The Select label may contain only the trigger. Its bounded Dropdown parent
    // owns a sibling popup; stopping at the inner label loses those candidates.
    return owner;
  }
  function promoteStructuralChoice(entry,root) {
    entry.kind='combobox';entry.root=root;
    entry.trigger=root.matches('.ud__select')?comboTriggerFor(root):root.querySelector('input:not([type="hidden"])')||root;
    entry.structuralChoice=true;
    provenChoiceRoots.add(root);
    return entry;
  }

  function collectComboboxRoots() {
    const roots = [];
    const claimed = new Set();
    const structuralRoots = new Set();

    const addRoot = (anchor) => {
      if (!anchor || roots.includes(anchor) || roots.some((item) => item.contains(anchor) || anchor.contains(item))) {
        return;
      }
      // 原生 select 已经走原生通道
      if (anchor.querySelector?.("select")) {
        return;
      }
      roots.push(anchor);
    };

    Array.from(document.querySelectorAll(COMBO_ROOT_SELECTOR)).forEach((element) => {
      if (element.closest(`#${SIDEBAR_ID}`) || controlPopupFor(element) || !isVisible(element)) {
        return;
      }
      // 组件库容器取最外层那一个，避免一层套一层重复成两个字段。
      const root = element.matches(COMBO_LIBRARY_SELECTOR) ? element : element.closest(COMBO_LIBRARY_SELECTOR);
      const bounded=!root&&element instanceof HTMLInputElement?structuralChoiceRoot(element):null;
      addRoot(root || bounded || element);
      if(bounded&&roots.includes(bounded))structuralRoots.add(bounded);
    });

    // A library name is optional. Recognize a bounded input + choice-list widget,
    // including editable school/major autocomplete and readonly arrow triggers.
    // Native datalists remain text inputs; they explicitly permit free text.
    document.querySelectorAll('input[type="text"],input[type="search"],input:not([type])').forEach(input=>{
      if(!isVisible(input)||roots.some(root=>root.contains(input)))return;
      const root=structuralChoiceRoot(input);
      if(root){addRoot(root);if(roots.includes(root))structuralRoots.add(root);}
    });

    // 名单外的自定义下拉。飞书的「学历 / 语言 / 精通程度」在页面里就是一个
    // input[type=search]，外层容器类名哪个组件库都不认识，于是被当成普通搜索框：
    // 值写进去了、事件也发了，组件按自己的 state 重渲染，界面上什么都不留。
    // 只收「不可能是普通文本框」的触发器（search 类型或带 listbox 语义），
    // 日期框排除掉 —— 那些要走日历面板通道。
    Array.from(document.querySelectorAll(
      "input[type='search'], input[aria-haspopup='listbox'], input[aria-autocomplete='list'], [aria-haspopup='listbox']"
    )).forEach((element) => {
      if (element.closest(`#${SIDEBAR_ID}`) || controlPopupFor(element) || !isVisible(element)) {
        return;
      }
      if (roots.some((root) => root.contains(element) || element.contains(root))) {
        return;
      }
      if (element.closest("[class*='picker'], [class*='calendar'], [class*='date-'], [class*='Date']")) {
        return;
      }
      if (DATE_PLACEHOLDER.test(element.getAttribute("placeholder") || "")) {
        return;
      }

      let root = element.closest("[class*='select'], [class*='cascader'], [class*='dropdown'], [class*='combo'], [class*='autocomplete']");
      // 匹配到的容器把一整段表单都包进去了（类名里带 select 的外层布局），
      // 收进来会把同段别的字段一起吃掉，退回直接父元素。
      if (!root || root.querySelectorAll("input, textarea, select").length > 2) {
        root = element.parentElement;
      }
      // 父元素同样太大就只认触发器自己：宁可少一个容器，也不能把邻居字段吃掉。
      if (root && root !== element && root.querySelectorAll("input, textarea, select").length > 2) {
        root = element;
      }
      if (!root || !isVisible(root)) {
        return;
      }
      // 取不到标签的组合框不会进字段表，而它内部的输入框又会被 claimed 排掉，
      // 结果这个控件从字段表里彻底消失 —— 比当成普通输入框更糟。
      // 所以只认结构上真有字段名的：靠 placeholder 兜底出来的名字（页头站内搜索框
      // 那种「搜索职位」）不足以说明这是表单里的下拉，升级错了只会白点一次还填不上。
      const trigger = comboTriggerFor(root);
      const shownText = sanitizeLabelText(comboTriggerText(trigger));
      if (!formItemLabel(root, shownText) && !comboLabelFromFormItem(root)) {
        return;
      }
      addRoot(root);
    });

    roots.forEach((root) => {
      // 触发器自己就是输入框时（role=combobox 挂在 input 上），querySelectorAll 收不到它本身，
      // 同一个控件会被扫成两个字段：一个组合框、一个普通搜索框。
      if (root.matches?.("input, textarea, select")) {
        claimed.add(root);
      }
      root.querySelectorAll("input, textarea, select").forEach((inner) => claimed.add(inner));
    });

    return { roots, claimed, structuralRoots };
  }

  const DATE_PLACEHOLDER = /(yyyy|YYYY)\s*[-/年]|\d{4}\s*[-/]\s*\d{1,2}|月\s*[-/日]\s*(dd|日)|年\s*月/;
  const DATE_LABEL = /起止|开始时间|结束时间|开始日期|结束日期|毕业时间|入学时间|工作时间|任职时间|出生日期/;

  function looksLikeDateInput(element, label, placeholder) {
    if (!(element instanceof HTMLInputElement)) {
      return false;
    }
    if (!["text", "search"].includes(element.type)) {
      return false;
    }

    return DATE_PLACEHOLDER.test(placeholder || "") || DATE_LABEL.test(label || "");
  }

  // 区间选择器是两个输入框共用一个「起止时间」标签。不拆开的话，
  // 两个框同名同值，段号分不出、模板里的「开始时间 / 结束时间」也对不上，
  // 模型看到的是两个一模一样的字段。
  function pickerRangeLabel(base, position, total) {
    const label = sanitizeLabelText(base);
    if (total < 2) {
      return label;
    }

    const edge = position === 0 ? "开始" : position === total - 1 ? "结束" : `第${position + 1}段`;
    if (!label || /起止|起讫|时间|日期|date/i.test(label)) {
      return `${edge}时间`;
    }
    return `${label}-${edge}`;
  }

  // <label>性别<input>男</label> 这种写法里，每颗单选各自被一个 label 包着，
  // 直接拿 parentElement 当作用域会把一组拆成几颗单独的组。跳过包裹自己的 label，
  // 落到真正共用的那个父节点上。
  function radioScopeOf(element) {
    const container = element.closest("fieldset, [role='radiogroup'], [class*='form-item'], [class*='radio-group'], tr, li");
    if (container) {
      return container;
    }

    let node = element.parentElement;
    while (node && node.tagName === "LABEL" && node.querySelectorAll("input[type=radio]").length <= 1) {
      node = node.parentElement;
    }

    return node || element;
  }

  function scanFillableFields() {
    const combos = collectComboboxRoots();
    const candidates = Array.from(document.querySelectorAll(
      "input:not([type='hidden']):not([type='file']):not([type='button']):not([type='submit']):not([type='reset']):not([disabled]), textarea:not([disabled]), select:not([disabled])"
    )).filter((element) => isVisible(element) && !element.closest(`#${SIDEBAR_ID}`) && !controlPopupFor(element) && !combos.claimed.has(element));

    const fieldMap = new Map();
    const fields = [];
    const radioGroups = new Set();
    const radioScopes = new Map();

    candidates.forEach((element, index) => {
      if (element instanceof HTMLInputElement && element.type === "radio") {
        // 只看 name 会并错组：有站点把「性别」和「是否接受X」两组用同一个 name，
        // 四颗单选被当成一组，填其中一组就把另一组顶掉，模型也看不出这是两个问题。
        const scope = radioScopeOf(element);
        if (!radioScopes.has(scope)) {
          radioScopes.set(scope, radioScopes.size);
        }
        const groupName = element.name || `__radio__${index}`;
        const groupKey = `${groupName}::${radioScopes.get(scope)}`;

        if (radioGroups.has(groupKey)) {
          return;
        }

        radioGroups.add(groupKey);
        const radioElements = candidates.filter((candidate) =>
          candidate instanceof HTMLInputElement && candidate.type === "radio"
            && candidate.name === element.name && radioScopeOf(candidate) === scope);
        const fieldId = `field-radio-${fields.length}`;
        fieldMap.set(fieldId, { kind: "radio", elements: radioElements });
        fields.push({
          fieldId,
          label: getFieldLabel(element),
          placeholder: "",
          name: groupName,
          idAttr: "",
          ariaLabel: element.getAttribute("aria-label") || "",
          tagName: "input",
          inputType: "radio",
          options: radioElements.map((radio) => getRadioOptionLabel(radio)).filter(Boolean),
          group: findNearestGroupLabel(element)
        });
        return;
      }

      const fieldId = `field-${fields.length}-${fieldMap.size}`;
      const label = getFieldLabel(element);
      const placeholder = element.getAttribute("placeholder") || "";
      fieldMap.set(fieldId, { kind: "element", element, dateLike: looksLikeDateInput(element, label, placeholder) });
      fields.push({
        fieldId,
        label,
        placeholder,
        name: element.getAttribute("name") || "",
        idAttr: element.id || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        tagName: element.tagName.toLowerCase(),
        inputType: element instanceof HTMLInputElement ? element.type || "text" : element.tagName.toLowerCase(),
        options: element instanceof HTMLSelectElement
          ? Array.from(element.options).map((option) => option.text.trim()).filter(Boolean)
          : [],
        group: findNearestGroupLabel(element)
      });
    });

    const pickerSelectors = [
      { selector: ".ant-picker", pickerType: "antd" },
      // ant 3.x 和飞书 atsx 换皮版：日历输入框叫 *-calendar-picker / *-date-picker。
      { selector: skin(".ant-calendar-picker", ".ant-date-picker"), pickerType: "antd" },
      { selector: ".el-date-editor", pickerType: "element" },
      { selector: ".ivu-date-picker", pickerType: "iview" },
      // 区间选择器的类名通常是 date-range-picker / range-picker / ud__picker-range，
      // 不含「date-picker」这个连续子串，只认旧选择器时整类起止时间都扫不到。
      { selector: "[class*='date-picker'], [class*='datepicker'], [class*='range-picker'], [class*='date-range']", pickerType: "generic" },
      { selector: "[class*='picker']", pickerType: "generic" }
    ];
    // 同一个容器会被多条选择器命中，只按第一条归类，
    // 否则通用的那条会把 antd / element 的 pickerType 覆盖掉。
    const handledPickers = new WeakSet();
    // Period components expose two display targets but only one internal input.
    const periodRoots = Array.from(document.querySelectorAll('[class*="date-picker-period"]'))
      .filter(n => !n.matches('input') && isVisible(n) && !controlPopupFor(n) && !n.parentElement?.closest('[class*="date-picker-period"]'));
    for (const root of periodRoots) {
      const atsxLabels=Array.from(root.querySelectorAll('.atsx-date-picker-period-month-label')).filter(isVisible);
      const displays = atsxLabels.length ? atsxLabels : Array.from(root.querySelectorAll('*')).filter(n =>
        !n.matches('input,button') && isVisible(n) && !n.children.length &&
        /^(?:YYYY[-/]MM|\d{4}[-/]\d{1,2}|至今)$/i.test(n.textContent.trim()));
      if (displays.length !== 2) continue;
      // Drop internal storage inputs: never click or independently match them.
      for (let i=fields.length-1;i>=0;i--) {
        const node=fieldMap.get(fields[i].fieldId)?.element;
        if(root.contains(node)&&!node?.matches('[type="checkbox"],[type="radio"]')) {fieldMap.delete(fields[i].fieldId);fields.splice(i,1);}
      }
      const rangeId='period-'+fieldMap.size;
      displays.forEach((node,index)=>{
        const fieldId=rangeId+'-'+index;
        fieldMap.set(fieldId,{kind:'element',element:node,pickerRoot:root,pickerType:'antd',pickerInputType:'month',dateLike:true,rangeRoot:root,displayDate:true,atsxPeriod:atsxLabels.length===2,periodIndex:index});
        fields.push({fieldId,label:index?'结束时间':'开始时间',placeholder:'YYYY-MM',name:'',idAttr:'',ariaLabel:'',tagName:node.tagName.toLowerCase(),inputType:'date-picker',pickerType:'antd',pickerInputType:'month',rangeId,rangeRole:index?'end':'start',options:[],group:findNearestGroupLabel(root)});
      });
      handledPickers.add(root);
    }

    pickerSelectors.forEach(({ selector, pickerType }) => {
      document.querySelectorAll(selector).forEach((container) => {
        if (handledPickers.has(container) || periodRoots.some(root => handledPickers.has(root) && root.contains(container))) return;
        if (container.closest(`#${SIDEBAR_ID}`)) return;
        if (controlPopupFor(container)) return;
        if (!isVisible(container)) return;
        // file-picker / color-picker 这类也叫 picker，但不是日期。
        if (/file|color|emoji|image|upload/i.test(container.className || "")) return;
        handledPickers.add(container);

        const innerInputs = Array.from(container.querySelectorAll("input:not([type='hidden']):not([disabled])"))
          .filter(inner=>!inner.matches('[type="checkbox"],[type="radio"],[type="file"],[type="button"],[type="submit"],[type="reset"]')&&!combos.claimed.has(inner));
        const visibleInputs = innerInputs.filter((inner) => isVisible(inner));
        // 有的日期组件把真正的 input 藏起来（0 宽），只露一个 div 显示日期。
        // 一个可见输入框都没有时照样登记隐藏的那个：值写进它组件才认，
        // 只是读回要退回看容器的显示文本。
        const targets = visibleInputs.length ? visibleInputs : innerInputs.slice(0, 2);

        targets.forEach((inner, position) => {
          const pickerInputType = inferPickerInputType(container, inner);

          const existingEntry = Array.from(fieldMap.entries()).find(([, v]) => v.element === inner);
          if (existingEntry) {
            const [existingId, entryValue] = existingEntry;
            if (entryValue.pickerRoot && entryValue.pickerRoot !== container) return;
            entryValue.pickerType = pickerType;
            entryValue.pickerInputType = pickerInputType;
            entryValue.pickerRoot = container;
            entryValue.hiddenInput = !visibleInputs.length;
            const existingField = fields.find((f) => f.fieldId === existingId);
            if (existingField) {
              existingField.inputType = "date-picker";
              existingField.pickerType = pickerType;
              existingField.pickerInputType = pickerInputType;
              existingField.label = pickerRangeLabel(existingField.label, position, targets.length);
            }
            return;
          }

          const fieldId = `field-${fields.length}-${fieldMap.size}`;
          fieldMap.set(fieldId, {
            kind: "element",
            element: inner,
            pickerType,
            pickerInputType,
            pickerRoot: container,
            hiddenInput: !visibleInputs.length
          });
          fields.push({
            fieldId,
            label: pickerRangeLabel(getFieldLabel(inner), position, targets.length),
            placeholder: inner.getAttribute("placeholder") || "",
            name: inner.getAttribute("name") || "",
            idAttr: inner.id || "",
            ariaLabel: inner.getAttribute("aria-label") || "",
            tagName: "input",
            inputType: "date-picker",
            pickerType,
            pickerInputType,
            options: [],
            group: findNearestGroupLabel(inner)
          });
        });
      });
    });

    // 容器类名认不出来时（飞书的日期组件可能连 picker 都不含），区间日期会退化成
    // 两个同名普通输入框，模型看到两个一模一样的「起止时间」分不清哪个填开始。
    // 按「同一个父元素 + 都是日期形状 + 标签相同」拆开。必须按父元素分组，
    // 不能按标签全局分组 —— 六段项目经历各有一对，全局分组会拆成「第3段」「第4段」。
    const datePairsByParent = new Map();
    fields.forEach((field) => {
      const entry = fieldMap.get(field.fieldId);
      if (field.inputType === "date-picker" || !entry?.dateLike || !field.label) {
        return;
      }
      const parent = entry.element?.parentElement;
      if (!parent) {
        return;
      }
      datePairsByParent.set(parent, [...(datePairsByParent.get(parent) || []), field]);
    });
    datePairsByParent.forEach((group) => {
      if (group.length < 2 || !group.every((field) => field.label === group[0].label)) {
        return;
      }
      group.forEach((field, position) => {
        field.label = pickerRangeLabel(field.label, position, group.length);
      });
    });

    let unlabeledCombos = 0;
    const unlabeledComboHints = [];
    combos.roots.forEach((root) => {
      const structuralChoice=root.matches('.ud__select')||combos.structuralRoots.has(root)||!root.matches(COMBO_LIBRARY_SELECTOR)
        &&Boolean(root.matches('input[type="text"],input[type="search"],input:not([type])')||root.querySelector('input[type="text"],input[type="search"],input:not([type])'));
      const trigger = root.matches('.ud__select') ? comboTriggerFor(root) : structuralChoice ? root.querySelector('input:not([type="hidden"])')||root : comboTriggerFor(root);
      const label = getComboboxLabel(root, trigger);

      if (!label) {
        unlabeledCombos += 1;
        unlabeledComboHints.push(classHint(root));
      }

      const fieldId = `field-${fields.length}-${fieldMap.size}`;
      fieldMap.set(fieldId, { kind: "combobox", root, trigger, structuralChoice });
      fields.push({
        fieldId,
        label,
        placeholder: root.querySelector('input')?.getAttribute('placeholder') || '',
        name: "",
        idAttr: root.id || (structuralChoice?trigger.id:'') || "",
        ariaLabel: root.getAttribute("aria-label") || "",
        tagName: root.tagName.toLowerCase(),
        inputType: "combobox",
        // 选项要点开才渲染，扫描阶段拿不到；填写时再读，所以这里留空。
        options: [],
        group: findNearestGroupLabel(root)
      });
    });

    // Find a bounded common wrapper even when the two date inputs have separate inner wrappers.
    const dateFields=fields.filter(f=>{const e=fieldMap.get(f.fieldId);return e?.element instanceof HTMLInputElement&&(e.dateLike||f.inputType==='date-picker'||/^(date|month)$/.test(f.inputType));});
    const paired=new Set();
    for(const field of dateFields){
      if(paired.has(field.fieldId))continue;
      const input=fieldMap.get(field.fieldId).element;
      for(let scope=input.parentElement,depth=0;scope&&depth<4;scope=scope.parentElement,depth++){
        const members=dateFields.filter(f=>scope.contains(fieldMap.get(f.fieldId).element));
        if(members.length>2)break;
        if(members.length!==2)continue;
        const unrelated=Array.from(scope.querySelectorAll('input,textarea,select')).filter(n=>isVisible(n)&&!members.some(f=>fieldMap.get(f.fieldId).element===n)&&!n.matches('[type="checkbox"],[type="hidden"]'));
        if(unrelated.length)break;
        members.sort((a,b)=>fieldMap.get(a.fieldId).element.compareDocumentPosition(fieldMap.get(b.fieldId).element)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
        const hints=members.map(f=>`${f.placeholder} ${f.ariaLabel} ${f.name} ${f.idAttr}`);
        const marker=`${scope.className||''} ${scope.querySelector('label')?.textContent||''} ${(scope.previousElementSibling?.textContent||'').slice(0,30)}`;
        const roles=members.map((f,i)=>`${f.label} ${hints[i]}`);
        if(!/range|起止|起讫/i.test(marker)&&!(roles.some(t=>/开始|起始|start/i.test(t))&&roles.some(t=>/结束|截止|end/i.test(t))))continue;
        const reversed=/结束|截止|end/i.test(hints[0])&&/开始|起始|start/i.test(hints[1]);
        if(reversed)members.reverse();
        const id='range-'+members[0].fieldId;
        members.forEach((f,i)=>{f.label=i?'结束时间':'开始时间';f.rangeId=id;f.rangeRole=i?'end':'start';paired.add(f.fieldId);fieldMap.get(f.fieldId).rangeRoot=scope;});
        break;
      }
    }
    sortFieldsByDocumentOrder(fields, fieldMap);
    annotateSplitDates(fields, fieldMap);

    // 级联判断 (Cascade Detection)
    if (self.ResumeProAIHelpers?.detectCascadeGroups) {
      self.ResumeProAIHelpers.detectCascadeGroups(fields, fieldMap);
    }

    const sectionHeadings = collectSectionHeadings();
    fields.forEach(field => {
      const entry = fieldMap.get(field.fieldId);
      const anchor = entry?.kind === "radio" ? entry.elements?.[0] : entry?.root || entry?.element;
      field.contextGroup = field.group;
      field.group = findSectionHeading(anchor, sectionHeadings);
    });
    annotateRecordIndexes(fields, fieldMap);
    // Separate date dropdowns in the same repeated record still form a range.
    // Require one explicit start and one explicit end; never infer direction from DOM order alone.
    const recordDates=new Map();
    fields.filter(f=>f.recordIndex&&f.group&&fieldMap.get(f.fieldId)?.kind==='combobox'&&/开始时间|开始日期|入学时间|起始时间|结束时间|结束日期|毕业时间/.test(f.label||'')).forEach(f=>{
      const key=JSON.stringify([f.group,f.recordIndex,f.recordSignature]);recordDates.set(key,[...(recordDates.get(key)||[]),f]);
    });
    for(const list of recordDates.values()){
      const start=list.filter(f=>/开始|入学|起始/.test(f.label)),end=list.filter(f=>/结束|毕业/.test(f.label));
      if(start.length!==1||end.length!==1||list.length!==2)continue;
      [start[0],end[0]].forEach((f,i)=>{f.rangeId='record-'+start[0].fieldId;f.rangeRole=i?'end':'start';});
      const a=fieldMap.get(start[0].fieldId),b=fieldMap.get(end[0].fieldId);
      for(let scope=a.root.parentElement,depth=0;scope&&depth<12;scope=scope.parentElement,depth++){
        if(scope.contains(b.root)){a.rangeRoot=scope;b.rangeRoot=scope;break;}
      }
    }
    fields.filter(f=>f.rangeId).forEach(f=>{
      const peer=fields.find(other=>other.rangeId===f.rangeId&&other.fieldId!==f.fieldId);
      if(peer)fieldMap.get(f.fieldId).rangePeer=fieldMap.get(peer.fieldId);
      if(f.datePart)fieldMap.get(f.fieldId).rangeMembers=fields.filter(other=>other.rangeId===f.rangeId)
        .map(meta=>({meta,entry:fieldMap.get(meta.fieldId)}));
    });
    const awardRecords=new Set(fields.filter(f=>/^(获奖名称|奖项名称|获奖项)$/.test(f.label)).map(f=>JSON.stringify([f.group,f.recordIndex,f.recordSignature])));
    fields.forEach(f=>{if(f.recordSignature&&awardRecords.has(JSON.stringify([f.group,f.recordIndex,f.recordSignature])))f.group='获奖经历';});
    // Some project templates distinguish a short role (职责) from the separate
    // narrative field 项目中职责. Only that complete record shape authorizes this alias.
    fields.filter(f=>f.label==='职责'&&/项目/.test(f.group||'')&&f.inputType==='text').forEach(f=>{
      if(fields.some(other=>other.group===f.group&&other.recordIndex===f.recordIndex
        &&other.recordSignature===f.recordSignature&&other.label==='项目中职责'))f.label='项目角色';
    });
    fields.forEach(field=>{const entry=fieldMap.get(field.fieldId);if(entry?.kind==='combobox')entry.meta=field;});
    markUnreliableLabels(fields, fieldMap);

    // 认不出来的控件要留下线索：这些字段送到模型那里只是「未命名字段」，
    // 模型给不出值，用户看到的是一片空白，而快照里连一行都没有 —— 没法定位。
    // 只记类名，不记值。
    const dropped = unlabeledComboHints.map((hint) => ({ reason: "combo-no-label", hint }));
    fields.forEach((field) => {
      const entry = fieldMap.get(field.fieldId);
      const element = entry?.kind === "radio" ? entry.elements?.[0]
        : entry?.kind === "combobox" ? entry.root : entry?.element;

      if (field.labelUnreliable) {
        dropped.push({ reason: "label-was-value", hint: classHint(element) });
        return;
      }
      if (!field.label && !field.placeholder && !field.name && !field.idAttr && !field.ariaLabel) {
        dropped.push({ reason: "no-label", hint: classHint(element) });
      }
    });

    fields.forEach(field => {
      const entry=fieldMap.get(field.fieldId), family=controlCatalog.identify(entry?.root || entry?.element);
      if(family){field.controlFamily=family.id;field.controlEvidence=family.evidence;}
    });
    return { fields, fieldMap, unlabeledCombos, dropped: dropped.slice(0, 20), droppedTotal: dropped.length };
  }

  // 认不出来的控件只留类名 / role / type 这些结构线索，不留任何填写内容。
  function classHint(element) {
    const parts = [];
    for (let node = element, depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      const names = String(node.getAttribute?.("class") || "").split(/\s+/)
        // 插件自己加的高亮/标红类要剔掉：同一个控件会因为标红被拆成几条不同线索，去重失效。
        .filter((name) => name && !name.startsWith("resume-pro"))
        .slice(0, 5);
      if (names.length) {
        parts.push(names.join("."));
      }
    }

    const role = element?.getAttribute?.("role");
    const type = element?.getAttribute?.("type");
    return [parts.join(" < "), role ? `role=${role}` : "", type ? `type=${type}` : ""]
      .filter(Boolean).join(" ").slice(0, 180);
  }

  const PLACEHOLDER_LABEL = /^(yyyy|yy|mm|dd|hh|ss|年|月|日|时|分|秒|[-\/:.\s~→至起结束])+$/i;

  // 用户不会去 F12 里替我抓 DOM，插件得自己把证据带出来：
  // 除了扫描阶段认不出的控件，**写不进去的**和**标签退化成占位符的**也要留类名线索。
  // 前者是最需要补驱动的（飞书那 12 个日期框），后者说明真标签没找着。
  // 只记类名 / role / type 和平台自己的标签，不记任何填写内容；相同线索合并计数。
  function collectControlHints({ fields, fieldMap, outcomes, dropped = [] }) {
    const merged = new Map();
    let total = 0;
    const add = (item) => {
      if (!item?.hint) {
        return;
      }
      total += 1;
      const key = `${item.reason}|${item.label || ""}|${item.hint}`;
      const held = merged.get(key);
      if (held) {
        held.count += 1;
        return;
      }
      merged.set(key, { ...item, count: 1 });
    };

    (Array.isArray(dropped) ? dropped : []).forEach(add);

    const anchorOf = (entry) => entry?.kind === "radio" ? entry.elements?.[0]
      : entry?.kind === "combobox" ? entry.root : entry?.element;

    (fields || []).forEach((field) => {
      const entry = fieldMap?.get(field.fieldId);
      const element = anchorOf(entry);
      const label = sanitizeLabelText(field.label).slice(0, 20);

      if (label && (PLACEHOLDER_LABEL.test(label) || COMBO_PLACEHOLDER.test(label))) {
        add({ reason: "label-is-placeholder", label, control: formControlOf(entry, field), hint: classHint(element) });
      }

      const outcome = outcomes?.get(field.fieldId);
      if (outcome && !outcome.ok && !outcome.kept && !outcome.skipped && !outcome.notAttempted && entry?.fillIssue !== 'choice-mismatch') {
        add({
          reason: "write-rejected",
          label: label || "(无名)",
          control: formControlOf(entry, field),
          hint: classHint(element)
        });
      }
    });

    const list = [...merged.values()];
    return { list: list.slice(0, 24), total };
  }

  // 自动点击采集的目标：只要自定义控件，上游缺的正是这些控件弹层的结构。
  // radio/checkbox 点下去会改掉用户已经选好的值；原生 <select> 弹的是系统下拉，CDP 关不掉 —— 都不采。
  function buildCaptureTargets({ fields, fieldMap, outcomes }) {
    const primary = [];
    const secondary = [];
    const seen = new Set();

    const push = (field, reason, bucket) => {
      const entry = fieldMap?.get(field.fieldId);
      const control = formControlOf(entry, field);
      if (control !== "combobox" && control !== "date-picker") return;
      // 点哪里必须和填写时一致（见 writeCalendarPanelDate 的 trigger）：只有隐藏 input 的
      // 日期控件才点外层 picker，有可见 input 就点 input —— 点容器正中心会落在日历图标上，面板打不开。
      const node = entry?.kind === "combobox" ? entry.trigger || entry.root
        : entry?.hiddenInput ? entry.pickerRoot : entry?.element || entry?.pickerRoot;
      if (!node?.isConnected || seen.has(node)) return;
      seen.add(node);
      bucket.push({
        reason,
        control,
        node,
        hint: classHint(entry?.kind === "combobox" ? entry.root : node),
        // 标签位置上显示的可能就是简历里的值，这种标签不进导出文件。
        label: field.labelUnreliable ? "" : sanitizeLabelText(field.label).slice(0, 20),
        labelSafe: !field.labelUnreliable,
        source: "fill-failure"
      });
    };

    (fields || []).forEach((field) => {
      const entry = fieldMap?.get(field.fieldId);
      const outcome = outcomes?.get(field.fieldId);
      if(outcome?.notAttempted){
        if(entry&&!hasExistingValue(entry))push(field,'not-attempted',secondary);
        return;
      }
      if (outcome && !outcome.ok && !outcome.kept && !outcome.skipped && entry?.fillIssue !== 'choice-mismatch') {
        return push(field, outcome.failureReason || "write-rejected", primary);
      }
      if (field.labelUnreliable) return push(field, "label-was-value", primary);
      if (!field.label && !field.placeholder && !field.name && !field.idAttr && !field.ariaLabel) return push(field, "no-label", primary);
      // 页面上已经有值的控件不用再采：它们会挤占有限的点击名额，把真正没填上的顶出去。
      if (!outcome && entry && !hasExistingValue(entry)) push(field, "not-attempted", secondary);
    });

    return controlCatalog.sampleTargets([...primary, ...secondary],24);
  }

  // 点容器正中心可能落在日历图标上（飞书的获奖时间控件就是这样点开不了的）：
  // 日期类控件有可见 input 就点 input，和填写时 writeCalendarPanelDate 的选择一致；
  // 隐藏 input 的情况仍然点外层容器。
  function captureClickNode(node) {
    if(node.matches('.ud__select'))return comboTriggerFor(node);
    if (!node.matches('[class*="date-picker"],[class*="calendar-picker"],.ant-picker,[class*="date-editor"]')) return node;
    // 组件内部的隐藏 input 只是焦点与存值位置，点它等于没点（atsx-date-picker-period-hidden-input 就是这种）。
    // 这类 input 常常还有 8×6 的实际盒子，而 isVisible 不看 opacity，所以这里自己判一遍。
    const input = Array.from(node.querySelectorAll("input")).find((element) => {
      if (element.type === "hidden" || element.disabled) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    });
    return input || node;
  }

  // 没跑过填写时的兜底：直接扫页面上的自定义控件。嵌套容器只留最外层，免得同一个下拉被点两次。
  function scanCaptureTargets() {
    const captureRoot = self.ResumeProControlCapture.ROOT;
    const roots = Array.from(document.querySelectorAll(`${captureRoot}, ${COMBO_ROOT_SELECTOR}`))
      .filter((node) => isVisible(node) && !node.closest(`#${SIDEBAR_ID}`))
      .filter((node, index, all) => !all.some((other) => other !== node && other.contains(node)));
    const seen = new Set();
    const targets = [];
    for (const node of roots) {
      // 采集要以 selectRoot 认得出的那一层为准：库容器（.ant-select）不在 ROOT 词表里，
      // 交给 recorder 会被判成 no-root，真正要点开的是里面的触发器。
      const found = node.matches(captureRoot) ? node : node.querySelector(`${COMBO_TRIGGER_SELECTOR}, ${captureRoot}`) || node;
      const trigger = found.matches('.ud__select') ? comboTriggerFor(found) : captureClickNode(found);
      if (!trigger.isConnected || seen.has(trigger)) continue;
      seen.add(trigger);
      targets.push({
        reason: "page-scan",
        control: node.matches(COMBO_ROOT_SELECTOR) ? "combobox" : "date-picker",
        node: trigger,
        hint: classHint(node),
        label: "",
        labelSafe: false,
        source: "page-scan"
      });
    }
    return targets.slice(0, 24);
  }

  // 标签是不是真的字段名。Moka、北森这类站点的输入框没有 <label> 关联，通用解析会退到
  // 「相邻元素的文本」，而那个位置显示的往往是用户已经填进去的值 —— 于是值冒充字段名，
  // 流进发给 AI 的请求和本地的结构快照。有真关联的算可信；没有关联又正好等于页面上
  // 某个控件当前值的，清空标签，只留 name / id / placeholder 这些结构线索。
  function markUnreliableLabels(fields, fieldMap) {
    const hasAssociation = (element) => Boolean(
      element?.getAttribute?.("data-label") || element?.labels?.length || element?.getAttribute?.("aria-labelledby")
    );

    // 组合框的显示文本取自控件内部，标签和它自己读回的值天然相同 —— 只能跟
    // 别的字段的值比，否则「民族」这种会被自己的显示文本误杀。
    const values = fields.map((field) => readFieldValue(fieldMap.get(field.fieldId), field));
    const valueCount = new Map();
    const countValue = (value) => {
      if (value && value.length <= 40) {
        valueCount.set(value, (valueCount.get(value) || 0) + 1);
      }
    };
    values.forEach(countValue);
    // 只读和禁用的控件不在扫描名单里，但它们照样显示值（北森「中国大陆」那个前缀框就是），
    // 这些值同样可能冒充成相邻输入框的标签。
    document.querySelectorAll("input, textarea, select, [contenteditable]").forEach((element) => {
      if (element.closest(`#${SIDEBAR_ID}`)) {
        return;
      }
      if (element.type === "checkbox" || element.type === "radio") {
        return;
      }
      countValue(String(element.value ?? element.textContent ?? "").trim());
    });

    fields.forEach((field, index) => {
      if (!field.label) {
        return;
      }

      const entry = fieldMap.get(field.fieldId);
      const element = entry?.kind === "radio" ? entry.elements?.[0] : entry?.kind === "combobox" ? entry.root : entry?.element;
      const occurrences = valueCount.get(field.label) || 0;
      // 普通输入框的标签永远不该等于它自己当前填的值，相等就可疑（Moka 那种值就显示在
      // 框旁边的情况靠这条挡住）；组合框和单选的显示文本本来就在控件内部，只有等于
      // 别的字段的值才算可疑。
      const displaysOwnText = entry?.kind === "combobox" || entry?.kind === "radio";
      const fromOthers = occurrences - (displaysOwnText && values[index] === field.label ? 1 : 0);
      if (hasAssociation(element) || (element?.type === 'checkbox' && getCheckboxLabel(element) === field.label) || fromOthers <= 0) {
        return;
      }

      field.labelUnreliable = true;
      field.label = "";
    });
  }

  function sortFieldsByDocumentOrder(fields, fieldMap) {
    const anchorOf = (field) => {
      const entry = fieldMap.get(field.fieldId);
      if (entry?.kind === "radio") return entry.elements?.[0];
      return entry?.root || entry?.element;
    };

    fields.sort((left, right) => {
      const a = anchorOf(left);
      const b = anchorOf(right);
      if (!a || !b) return 0;
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function comboLabelFromFormItem(root) {
    let node = root;

    for (let depth = 0; node && depth < 5; depth += 1) {
      const item = node.closest(".ant-form-item, .el-form-item, [class*='form-item'], [class*='form-group'], li, tr, td, dl");
      if (!item) {
        break;
      }

      const label = item.querySelector(".ant-form-item-label, .el-form-item__label, label, legend, th, dt, [class*='-label'], [class*='label']");
      const text = sanitizeLabelText(label?.textContent).replace(/[*：:\s]+$/, "");
      if (text && text.length <= 20 && !COMBO_PLACEHOLDER.test(text)) {
        return text;
      }

      const before = sanitizeLabelText(item.previousElementSibling?.textContent).replace(/[*：:\s]+$/, "");
      if (before && before.length <= 20 && !COMBO_PLACEHOLDER.test(before)) {
        return before;
      }

      node = item.parentElement;
    }

    return "";
  }

  function getComboboxLabel(root, trigger) {
    // 先按表单项结构找标签：组合框内部往往带着「当前选中值」的文本，
    // 直接用通用标签解析会把选中值当成标签。
    // formItemLabel 带方位和邻居校验，一行并排两个下拉时不会串到隔壁的名字。
    const shown = sanitizeLabelText(comboTriggerText(trigger));
    const fromFormItem = formItemLabel(root, shown);
    if (fromFormItem) {
      return fromFormItem;
    }

    const fromItem = comboLabelFromFormItem(root);
    if (fromItem) {
      return fromItem;
    }

    for(let scope=root.parentElement,depth=0;scope&&depth<8;depth++,scope=scope.parentElement){
      const others=Array.from(scope.querySelectorAll('input,textarea,select,[role="combobox"]')).filter(n=>!root.contains(n)&&n!==root&&isVisible(n));
      if(others.length)break;
      const labels=Array.from(scope.querySelectorAll('label,[class*="label"],[class*="title"]')).filter(n=>!n.contains(root)&&!root.contains(n)&&(n.compareDocumentPosition(root)&Node.DOCUMENT_POSITION_FOLLOWING));
      const text=labels.map(n=>stableLabelText(n)).filter(t=>t&&t.length<=30&&!isFormatPlaceholder(t));
      if(new Set(text).size===1)return text[0].replace(/[*＊：:\s]+$/, '');
    }
    const direct = sanitizeLabelText(getFieldLabel(root.querySelector("input, textarea") || trigger));
    // 拿回来的文本正是控件里显示的值，那不是字段名。
    if (!direct || COMBO_PLACEHOLDER.test(direct) || (shown && direct === shown)) {
      return "";
    }
    return direct;
  }

  // 多段经历里的同名字段（五个「项目名称」）对模型来说本来一模一样，
  // 标上「第几段」它才能把每段的数据填进对应那一行。
  const RECORD_MIN_FIELDS = 2;
  const RECORD_MAX_PEERS = 12;
  // 组件库的容器嵌套很深（组合框的锚点比同一段里的输入框深好几层），层数给少了
  // 会出现同一段里输入框拿到段号、下拉拿不到。判定结果按父节点缓存，多走几层不贵。
  const RECORD_MAX_DEPTH = 32;

  function fieldAnchor(entry) {
    return entry?.kind === 'radio' ? entry.elements?.[0] : entry?.root || entry?.element;
  }

  // Resolve split date selectors before looking for repeated resume records.
  function annotateSplitDates(fields, fieldMap) {
    const helpers=self.ResumeProAIHelpers;
    if(!helpers) return;
    const anchors=fields.map(field=>({field,element:fieldAnchor(fieldMap.get(field.fieldId))})).filter(item=>item.element);
    const hintPart=field=>{
      const entry=fieldMap.get(field.fieldId),element=entry?.trigger||entry?.element;
      const captions=[field.placeholder,field.ariaLabel,element?.getAttribute('placeholder')];
      if(element instanceof HTMLSelectElement)captions.push(element.options[0]?.text);
      if(captions.some(text=>/^(?:请(?:选择|输入))?(?:年|年份|YYYY)$/i.test(String(text||'').trim())))return 'year';
      if(captions.some(text=>/^(?:请(?:选择|输入))?(?:月|月份|MM)$/i.test(String(text||'').trim())))return 'month';
      const name=`${field.name} ${field.idAttr}`.replace(/([a-z])([A-Z])/g,'$1 $2');
      if(/(?:^|[\s_-])year(?:$|[\s_-])/i.test(name))return 'year';
      if(/(?:^|[\s_-])month(?:$|[\s_-])/i.test(name))return 'month';
      if(/时间|日期|年月|生日/.test(field.label||'')){
        const options=(field.options||[]).filter(option=>!helpers.isPlaceholderOption(option));
        if(options.length>=2&&options.every(option=>helpers.normalizeDatePart(option,'year')))return 'year';
        const months=new Set(options.map(option=>helpers.normalizeDatePart(option,'month')));
        if(options.length===12&&months.size===12&&!months.has(''))return 'month';
      }
      return '';
    };
    const parts=new Map(anchors.map(item=>[item.field.fieldId,hintPart(item.field)]).filter(([,part])=>part));
    const handled=new Set();
    for(const item of anchors){
      if(!parts.has(item.field.fieldId)||handled.has(item.field.fieldId))continue;
      let best;
      for(let scope=item.element.parentElement,depth=0;scope&&scope!==document.body&&depth<RECORD_MAX_DEPTH;scope=scope.parentElement,depth++){
        const members=anchors.filter(anchor=>scope.contains(anchor.element)&&anchor.field.inputType!=='checkbox');
        if(members.length>4||members.some(anchor=>!parts.has(anchor.field.fieldId)))break;
        if(members.length!==2&&members.length!==4)continue;
        const sequence=members.map(anchor=>parts.get(anchor.field.fieldId)).join(',');
        if(sequence!=='year,month'&&sequence!=='year,month,year,month')continue;
        const labels=[...new Set(members.map(anchor=>anchor.field.label).filter(Boolean))];
        const label=labels.find(text=>/时间|日期|年月|生日/.test(text));
        if(!label)continue;
        if(members.length===2){best={scope,members,label};continue;}
        const roleOf=anchor=>{
          const hints=[anchor.field.label,anchor.field.name,anchor.field.idAttr,anchor.field.ariaLabel];
          for(let node=anchor.element,step=0;node&&node!==scope&&step<8;node=node.parentElement,step++){
            hints.push(node.getAttribute('data-date-role'),node.getAttribute('aria-label'));
          }
          const text=hints.filter(Boolean).join(' ');
          return /结束|毕业|截止|(?:^|[\s_-])end(?:$|[\s_-])/i.test(text)?'end'
            :/开始|入学|起始|(?:^|[\s_-])start(?:$|[\s_-])/i.test(text)?'start':'';
        };
        let roles=members.map(roleOf);
        const explicit=roles[0]&&roles[0]===roles[1]&&roles[2]&&roles[2]===roles[3]&&roles[0]!==roles[2];
        // The range dash is often a bare text node between nested dropdown wrappers.
        // Read only visible text outside the four controls and their option panels;
        // looking at element leaves misses that dash, while scope.textContent reads options.
        const texts=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);
        let separator=false;
        for(let node=texts.nextNode();node;node=texts.nextNode()){
          if(!/^(?:至|到|[-–—~～])$/.test(node.textContent.trim()))continue;
          const parent=node.parentElement;
          if(!parent||!isVisible(parent)||members.some(anchor=>anchor.element.contains(node))
            ||parent.closest(`select,input,textarea,${COMBO_ROOT_SELECTOR},${CONTROL_POPUP_SELECTOR}`))continue;
          if((members[1].element.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING)
            &&(node.compareDocumentPosition(members[2].element)&Node.DOCUMENT_POSITION_FOLLOWING)){separator=true;break;}
        }
        if(!explicit&&!(separator&&/起止|起讫|就读|时间|日期/.test(label))){
          if(labels.length===1)best={scope,members,label,unresolved:true};
          continue;
        }
        if(!explicit)roles=['start','start','end','end'];
        best={scope,members,label,roles};
      }
      if(!best)continue;
      const {scope,members,label,roles,unresolved}=best,id='split-'+members[0].field.fieldId;
      members.forEach(({field},index)=>{
        field.datePart=parts.get(field.fieldId);
        if(unresolved)field.dateRangeUnresolved=true;
        if(roles){field.rangeId=id;field.rangeRole=roles[index];field.label=roles[index]==='start'?'开始时间':'结束时间';}
        else {field.datePointId=id;field.label=label;}
        const entry=fieldMap.get(field.fieldId);entry.dateLike=false;entry.datePart=field.datePart;
        if(roles)entry.rangeRoot=scope;
        handled.add(field.fieldId);
      });
    }
  }

  function annotateRecordIndexes(fields, fieldMap) {
    const anchors = [];
    fields.forEach((field) => {
      const entry = fieldMap.get(field.fieldId);
      const element = entry?.kind === "radio" ? entry.elements?.[0]
        : entry?.kind === "combobox" ? entry.root : entry?.element;
      if (element) {
        anchors.push({ field, element });
      }
    });

    const cache = new Map();

    anchors.forEach(({ field, element }) => {
      for (let member = element.parentElement, depth = 0; member && depth < RECORD_MAX_DEPTH; depth += 1, member = member.parentElement) {
        const peers = recordGroupFor(member, anchors, cache);
        if (peers) {
          field.recordIndex = peers.indexOf(member) + 1;
          field.recordTotal = peers.length;
          // 本段的字段标签集合。公司多插一个自定义字段会让段号错位，
          // 签名对不上就不该再照映射硬填。
          const api = self.ResumeProFormStructure;
          field.recordSignature = anchors
            .filter((item) => member === item.element || member.contains(item.element))
            .map((item) => (api ? api.normalizeLabel(item.field.label) : String(item.field.label || "")) + (item.field.datePart ? `[${item.field.datePart}]` : ''))
            .filter(Boolean).sort().join("|");
          return;
        }
      }
    });
  }

  // 判定依据不是某个 CSS 类名，而是结构本身：同一父节点下同标签的若干兄弟里，
  // 字段标签集合完全相同的那一批（至少两个、每个至少两个字段）才算一组重复条目。
  // 按签名分桶而不是要求所有兄弟都合格 —— 容器里多一个分隔行或「添加」按钮，
  // 不该把真正的重复块一起废掉。
  function recordGroupFor(member, anchors, cache) {
    const parent = member.parentElement;
    if (!parent) {
      return null;
    }

    let byTag = cache.get(parent);
    if (!byTag) {
      byTag = new Map();
      cache.set(parent, byTag);
    }
    const signatureOf = (peer) => {
      const members=anchors.filter(item=>peer===item.element||peer.contains(item.element));
      // Date endpoints and year/month wrappers belong to one date item.
      if(members.length<RECORD_MIN_FIELDS||members.every(item=>item.field.datePart
        ||/时间|日期|年月/.test(item.field.label||'')))return '';
      // A missing separator changes date certainty, not which outer experience
      // owns the controls. Keep that distinction in recordSignature, not the bin.
      return members.map(item=>JSON.stringify([item.field.group||'',item.field.datePart?'日期部分':item.field.label||'',item.field.datePart||''])).sort().join('|');
    };
    if(!byTag.has(member.tagName)) {
      const buckets=new Map();
      Array.from(parent.children).filter(sibling=>sibling.tagName===member.tagName).forEach(peer=>{
        const signature=signatureOf(peer);
        if(signature)buckets.set(signature,[...(buckets.get(signature)||[]),peer]);
      });
      byTag.set(member.tagName,buckets);
    }
    const group=byTag.get(member.tagName).get(signatureOf(member));
    return group&&group.length>=2&&group.length<=RECORD_MAX_PEERS?group:null;
  }

  // 表单项容器里的标签元素。飞书这类站点的日期框和自定义下拉没有 <label> 关联，
  // 通用解析会一路退到「相邻元素文本」或 placeholder —— 那个位置显示的往往是
  // 控件当前值（「本科」）或日期格式串（「YYYY」），拿这种字符串去和模板键匹配
  // 永远对不上，整组字段就静默空着。所以先按表单项结构正经找一次标签。
  const FORM_ITEM_SELECTOR = `${controlCatalog.selector('formItem')}, .ant-form-item, .arco-form-item, .semi-form-field, [class*='form-item'], [class*='formItem'], [class*='form-field'], [class*='formField'], [class*='field-wrap'], [class*='form-row'], [class*='formRow']`;
  const FORM_LABEL_SELECTOR = `${controlCatalog.selector('label')}, [class*='label'], label, legend, dt, th`;

  function formItemLabel(element, ownText = "") {
    const own = sanitizeLabelText(ownText);
    const udItem=controlCatalog.fieldRoot(element);
    if(udItem){
      const labels=Array.from(udItem.querySelectorAll('[class*="ud-formily-item-label"]'))
        .filter(n=>!n.querySelector('input,textarea,select')&&!n.contains(element)&&!element.contains(n))
        .filter((n,i,all)=>!all.some(other=>other!==n&&other.contains(n)))
        .map(n=>stableLabelText(n).replace(/[*＊：:\s]+$/,''))
        .filter(text=>text&&text.length<=20&&!COMBO_PLACEHOLDER.test(text)&&!isFormatPlaceholder(text));
      if(new Set(labels).size===1){
        const text=labels[0];
        const choice=element.closest('.ud__select')||element.matches('.ud__select')&&element;
        const phones=Array.from(udItem.querySelectorAll('input')).filter(n=>!n.closest('.ud__select')&&n.type!=='hidden');
        if(choice&&phones.length===1&&/手机|电话/.test(text))return '手机区号';
        return text;
      }
      return '';
    }
    const visited = new Set();

    for (let node = element, depth = 0; node && depth < 32; depth += 1, node = node.parentElement) {
      const item = node.closest(FORM_ITEM_SELECTOR);
      if (!item || visited.has(item)) {
        continue;
      }
      visited.add(item);

      for (const candidate of Array.from(item.querySelectorAll(FORM_LABEL_SELECTOR))) {
        // 标签里套着输入框（<label>性别<input></label>）或者套着选中值的显示区，
        // 取出来的文本会带上值，都不能当字段名。
        if (candidate.contains(element) || element.contains(candidate)) continue;
        if (candidate.matches('[class*="label-help"],[class*="item-help"],[role="tooltip"]')) continue;
        if (candidate.querySelector("input, textarea, select")) continue;
        if (candidate.querySelector(COMBO_DISPLAY_SELECTOR)) continue;
        // 标签必须排在控件前面：一行里并排两个字段时，
        // 取到后一个的名字就会把值填错位置。
        if (!(candidate.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;

        // 标签所在的表单项里还有别的可见控件，说明这个标签是邻居的。
        // 作用域要从标签的父级往上找：标签元素自己的类名（ud__form-item__label）
        // 也含「form-item」这个子串，closest 会退回标签自身，校验就形同虚设。
        let scope = candidate.parentElement?.closest(FORM_ITEM_SELECTOR);
        if (!scope || !scope.contains(element)) {
          scope = item;
        }
        // 勾选框（日期格子里的「至今」）和同一个日期容器里的兄弟框不是竞争者：
        // 它们在场不代表这个标签是邻居的。飞书的起止时间格里就带一个勾选框，
        // 结果标签被判给邻居、退回了占位符 YYYY-MM。
        const ownPicker = element.closest("[class*='picker'], [class*='calendar'], [class*='date']");
        const others = Array.from(scope.querySelectorAll("input, textarea, select, [role='combobox']"))
          .filter((node) => isVisible(node) && node !== element && !node.contains(element) && !element.contains(node))
          .filter((node) => node.type !== "checkbox" && node.type !== "radio")
          .filter((node) => !ownPicker || !ownPicker.contains(node));
        if (others.length) continue;

        const text = sanitizeLabelText(candidate.textContent).replace(/[*＊：:\s]+$/, "");
        if (!text || text.length > 20 || COMBO_PLACEHOLDER.test(text)) continue;
        if (own && text === own) continue;
        return text;
      }
    }

    return "";
  }

  // 挂在页面上的浮层（下拉面板、日历面板、弹窗、气泡、抽屉）不是标签来源：
  // 它们的文本是一整串选项。页头搜索框就因为前一个兄弟是下拉面板，
  // 被标成了「XX大学 四川大学 电子科技大学」。
  const PORTAL_SELECTOR = `${CONTROL_POPUP_SELECTOR}, [class*='dropdown'], [class*='picker-container'], [class*='calendar'], [class*='modal'], [class*='dialog'], [class*='popover'], [class*='tooltip'], [class*='drawer'], [class*='overlay'], [role='listbox'], [role='dialog']`;

  function isPortalNode(node) {
    if (!node || !node.matches) {
      return false;
    }
    return node.matches(PORTAL_SELECTOR) || Boolean(node.querySelector?.(PORTAL_SELECTOR));
  }

  function stableLabelText(label) {
    const copy = label?.cloneNode(true);
    copy?.querySelectorAll("input, textarea, select, [role='combobox'], [role='listbox']").forEach(node => node.remove());
    return sanitizeLabelText(copy?.textContent);
  }

  function structuralFieldLabel(element) {
    const ownPicker = element.closest("[class*='picker'], [class*='calendar'], [class*='date']");
    for (let node = element, depth = 0; node?.parentElement && depth < 32; node = node.parentElement, depth++) {
      const scope = node.parentElement;
      if (scope === document.body || scope === document.documentElement) break;
      // Stop at the first scope shared with a different field. Never borrow a sibling's label.
      const competitors = Array.from(scope.querySelectorAll("input, textarea, select, [role='combobox']"))
        .filter(other => isVisible(other) && other !== element && !other.contains(element) && !element.contains(other))
        .filter(other => other.type !== 'checkbox' && other.type !== 'radio')
        .filter(other => !ownPicker || !ownPicker.contains(other));
      if (competitors.length) break;
      const labels = [];
      for (let candidate = node.previousElementSibling; candidate; candidate = candidate.previousElementSibling) {
        if (!isVisible(candidate) || isPortalNode(candidate)
          || candidate.matches('[role="tooltip"],[class*="help"],[class*="error"],[class*="hint"]')
          || candidate.querySelector("input, textarea, select, button, [role='combobox']")) continue;
        const text = stableLabelText(candidate).replace(/[*＊：:\s]+$/, '');
        if (text && text.length <= 20 && !COMBO_PLACEHOLDER.test(text) && !isFormatPlaceholder(text)) labels.push(text);
      }
      if (labels.length) return labels.length === 1 ? labels[0] : '';
    }
    return '';
  }

  function getFieldLabel(element) {
    if (element.type === 'checkbox') return getCheckboxLabel(element);
    const cleanedElementLabel = sanitizeLabelText(element.getAttribute("data-label"));
    if (cleanedElementLabel) return cleanedElementLabel;

    // 1. 标准 label 关联
    const controlShell=label=>label&&/\bsd-(?:Input|Select)-container(?:[-_\s]|$)|\bud__input-input-wrap\b/.test(String(label.className||''));
    if (element.labels?.length) {
      const labelText = sanitizeLabelText(Array.from(element.labels).filter(label=>!controlShell(label)).map((label) => stableLabelText(label)).join(" / "));
      if (labelText) return labelText;
    }

    // 2. label[for] 关联
    if (element.id) {
      const linked = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      const linkedText = controlShell(linked)?'':stableLabelText(linked);
      if (linkedText) return linkedText;
    }

    // 3. 包裹在 label 里
    const wrappingLabel = element.closest("label");
    const wrappingText = controlShell(wrappingLabel)?'':stableLabelText(wrappingLabel);
    if (wrappingText) return wrappingText;

    // 4. aria-labelledby
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = sanitizeLabelText(labelledBy.split(" ").map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" "));
      if (text) return text;
    }

    // 4.5 表单项容器里的标签元素。必须排在「相邻文本」前面 —— 相邻位置上
    // 显示的常常是控件已经选中的值，先走那一步就会把值当成字段名。
    const itemLabel = formItemLabel(element, element instanceof HTMLInputElement ? element.value : "");
    if (itemLabel) return itemLabel;
    const structureLabel = structuralFieldLabel(element);
    if (structureLabel) return structureLabel;

    // Formily field boundaries are explicit. A missing local label must not
    // borrow 姓名/学校名称 from an earlier field in the same resume section.
    if (element.closest('.ud-formily-item,[class*="ud-formily-item-control"]')) {
      return element.getAttribute('aria-label')?.trim() || element.getAttribute('placeholder')?.trim() || '';
    }

    // 5. 同一行的前一个兄弟元素文本（td/th/span/div/p）
    let sibling = element.previousElementSibling;
    while (sibling) {
      const text = isPortalNode(sibling) ? "" : sanitizeLabelText(sibling.textContent);
      if (text && text.length < 30) return text;
      sibling = sibling.previousElementSibling;
    }

    // 6. 父容器内、input 之前的文本节点或标签元素（常见于 td 布局）
    const parent = element.parentElement;
    if (parent) {
      // 找父容器的前一个兄弟（如 th/td）
      let parentSibling = parent.previousElementSibling;
      while (parentSibling) {
        const text = isPortalNode(parentSibling) ? "" : sanitizeLabelText(parentSibling.textContent);
        if (text && text.length < 30) return text;
        parentSibling = parentSibling.previousElementSibling;
      }

      // 父容器本身的直接文本（排除 input 本身的内容）
      const clone = parent.cloneNode(true);
      clone.querySelectorAll("input, select, textarea, button").forEach(el => el.remove());
      const text = sanitizeLabelText(clone.textContent);
      if (text && text.length < 30) return text;
    }

    // 7. 向上追溯祖先容器的前序单元格/标签，适配表格或复杂布局
    let current = parent;
    let depth = 0;
    while (current && depth < 5) {
      let previous = current.previousElementSibling;
      while (previous) {
        const text = isPortalNode(previous) ? "" : sanitizeLabelText(previous.textContent);
        if (text && text.length < 40) return text;
        previous = previous.previousElementSibling;
      }

      // 爬到 body / html 就不能再用 querySelector 了：那会拿到整个文档里第一个 label，
      // 把不相干字段的名字安到这个控件上（页头搜索框被标成「手机号码」就是这么来的）。
      const atDocumentRoot = current === document.body || current === document.documentElement;
      const scopedLabel = atDocumentRoot ? null : current.querySelector("label, th, .label, .form-label, [class*='form-item-label'], [class*='form-label']");
      const scopedText = sanitizeLabelText(scopedLabel?.textContent);
      if (scopedText && scopedText.length < 40
        && (scopedLabel.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        return scopedText;
      }

      current = current.parentElement;
      depth += 1;
    }

    // 8. placeholder 兜底
    return element.getAttribute("placeholder")?.trim() || "";
  }

  function getCheckboxLabel(element) {
    const explicit = element.getAttribute('data-label') || element.getAttribute('aria-label');
    if (explicit) return sanitizeLabelText(explicit);
    // Read the checkbox's own caption (e.g. 至今), never its outer 结束时间 form label.
    const wrapper = element.closest('.phoenix-checkbox,.ant-checkbox-wrapper,.atsx-checkbox-wrapper,.el-checkbox,.ivu-checkbox-wrapper,[role="checkbox"]');
    if (wrapper && wrapper.querySelectorAll('input').length === 1) {
      const text = stableLabelText(wrapper);
      if (text && text.length <= 30 && !isFormatPlaceholder(text)) return text;
    }
    if (element.labels?.length) return Array.from(element.labels).map(stableLabelText).filter(Boolean).join(' / ');
    const labelledBy = element.getAttribute('aria-labelledby');
    return labelledBy ? sanitizeLabelText(labelledBy.split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ')) : '';
  }

  function bindFocusTracking() {
    document.addEventListener("focusin", (event) => {
      const target = event.target;

      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.closest(`#${SIDEBAR_ID}`)) {
        return;
      }

      if (isFillTarget(target)) {
        state.lastFocusedField = target;
        closeChipActionMenu();
        syncChipSelectionState();
      }
    }, true);
    document.addEventListener("input", (event) => {
      if (event.target === state.lastFocusedField) {
        closeChipActionMenu();
        if (!chipWriteTargets.has(event.target)) {
          chipSelectionIdsByTarget.delete(event.target);
        }
        syncChipSelectionState();
      }
    }, true);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "readonly");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      const success = document.execCommand("copy");
      helper.remove();
      return success;
    }
  }

  function getLastFocusedFillTarget() {
    const candidates = [state.lastFocusedField, document.activeElement];

    for (const candidate of candidates) {
      if (candidate instanceof HTMLElement && isFillTarget(candidate) && document.contains(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function hasRealSelectOptions(select) {
    const isPlaceholder = self.ResumeProAIHelpers?.isPlaceholderOption;
    return Array.from(select.options || []).some((option) => String(option.text ?? "").trim()
      && !(isPlaceholder && isPlaceholder({ value: option.value, text: option.text, disabled: option.disabled })));
  }

  // 自定义下拉：点开 → 等新渲染出来的选项 → 匹配 → 点那一项。
  // 只在 AI 已经给出值的字段上执行，只点触发器和选项本身；对不上就收起并记下原因。
  function browserInputEnabled(){return Boolean(shadowRoot?.querySelector('#resume-pro-browser-input')?.checked);}
  async function browserAction(node,action){
    if(!node?.isConnected){const error=new Error('操作目标已被替换，未点击');error.code='input_target_missing';throw error;}
    const token=crypto.randomUUID();node.setAttribute('data-applyfill-input',token);
    try{const result=await chrome.runtime.sendMessage({type:'BROWSER_INPUT',action:{...action,token}});if(!result?.ok){const error=new Error(result?.error||'浏览器操作失败');error.code=safeInputErrorCode(result?.errorCode)||'input_transport';throw error;}return true;}
    finally{if(node.getAttribute('data-applyfill-input')===token)node.removeAttribute('data-applyfill-input');}
  }
  function browserInput(node,text,enter=false){return browserAction(node,{kind:text===undefined?'click':'fill',text,enter});}
  async function browserEscape(node){
    // Some triggers are plain divs with no input or tabindex. Temporarily make
    // this exact owned trigger focusable so Escape can reach its popup handler.
    const temporary=node?.isConnected&&!node.matches('input,textarea,select,[tabindex]')&&!node.querySelector('input:not([type="hidden"]):not([disabled]),[tabindex]');
    if(temporary)node.setAttribute('tabindex','-1');
    try{return await browserAction(node,{kind:'key',key:'Escape'});}
    finally{if(temporary&&node.getAttribute('tabindex')==='-1')node.removeAttribute('tabindex');}
  }
  async function calendarClick(node){if(browserInputEnabled())return browserInput(node);clickComboOption(node);}
  const atsxDateAgent=self.ResumeProAtsxDateAgent.create({click:calendarClick,visible:isVisible,read:readBackValue});
  const udDateAgent=self.ResumeProUdDateAgent.create({click:calendarClick,visible:isVisible,
    escape:node=>browserInputEnabled()?browserEscape(node):node.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),
    readPeer:readBackValue,refresh:entry=>entry.meta?refreshFieldEntry(entry.meta,entry):null});
  const genericDateAgent=self.ResumeProGenericDateAgent.create({
    visible:isVisible,click:calendarClick,
    escape:node=>browserInputEnabled()?browserEscape(node):node.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),
    dismiss:node=>browserInputEnabled()?browserAction(controlCatalog.dismissSurface(node)||node,{kind:'dismiss'}):null,
    read:readBackValue,
    peerValue:entry=>entry.rangePeer?readBackValue(entry.rangePeer):undefined,
    refresh:entry=>entry.meta?refreshFieldEntry(entry.meta,entry):null,
    input:async(node,text)=>{
      if(browserInputEnabled())return browserInput(node,text,true);
      node.focus();
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(node,text);
      node.dispatchEvent(new Event('input',{bubbles:true}));
      node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));
    }
  });

  async function fillCombobox(entry, value) {
    return comboAgent.fill(entry,value);
  }

  // React 可能在拿到引用之后重渲染下拉，点脱离文档的节点等于没点，所以点之前按文本重查。
  function freshOptionFor(entry,wantedText) {
    const found=comboAgent.options(entry).filter(option=>self.ResumeProFormStructure.normalizeLabel(option.textContent)===self.ResumeProFormStructure.normalizeLabel(wantedText));
    return found.length===1?found[0]:null;
  }

  function matchesAnyOption(options, value) {
    const api = self.ResumeProFormStructure;
    const wanted = api.normalizeLabel(value);
    return options.some((option) => api.normalizeLabel(option.textContent) === wanted);
  }

  function freshOptionsFor(entry) { return comboAgent.options(entry); }

  // 远程搜索型（打开是「暂无数据」）和依赖型（先选语言才出等级）都靠这个：
  // 往搜索框打关键词，等候选渲染出来。
  async function searchComboFor(entry, value) {
    const searchInput = entry.root?.querySelector(`${skin(".ant-select-search__field", ".ant-select-search input")}, .el-select__input, input[type='text'], input[type='search']`);
    if (!searchInput) {
      return null;
    }

    const descriptor = Object.getOwnPropertyDescriptor(searchInput.constructor.prototype, "value");
    const keyword = String(value).slice(0, 4);
    if (descriptor?.set) {
      descriptor.set.call(searchInput, keyword);
    } else {
      searchInput.value = keyword;
    }
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const options = freshOptionsFor(entry);
      if (options.length) {
        return options;
      }
    }
    return null;
  }

  // 树形多级：「四川省/资阳市」拆成两级，逐级点；子节点没渲染就先点父节点的展开箭头。
  async function clickTreePath(entry, value) {
    const api = self.ResumeProFormStructure;
    const parts = String(value).split(/[\/／]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) {
      return false;
    }

    let lastNode = null;
    for (const part of parts) {
      let node = freshOptionsFor(entry).find((option) => api.normalizeLabel(option.textContent || option.title) === api.normalizeLabel(part));
      if (!node && lastNode) {
        const switcher = lastNode.previousElementSibling;
        if (switcher) {
          clickComboOption(switcher);
          await new Promise((resolve) => setTimeout(resolve, 200));
          node = freshOptionsFor(entry).find((option) => api.normalizeLabel(option.textContent || option.title) === api.normalizeLabel(part));
        }
      }
      if (!node) {
        return false;
      }
      clickComboOption(node);
      await new Promise((resolve) => setTimeout(resolve, 150));
      lastNode = node;
    }

    return comboTook(entry, parts[parts.length - 1]) || comboTook(entry, value);
  }

  function clickComboOption(element) {
    ["mousedown", "mouseup", "click"].forEach((type) => {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
  }

  function deepestElement(element) {
    let node = element;
    while (node.firstElementChild) {
      node = node.firstElementChild;
    }
    return node === element ? null : node;
  }

  function comboTook(entry, expectedText) {
    const shown = readBackValue(entry);
    if (!shown || !expectedText) {
      return false;
    }
    const api = self.ResumeProFormStructure;
    return api.normalizeLabel(shown) === api.normalizeLabel(expectedText);
  }

  async function openComboboxOptions(entry) { return comboAgent.open(entry); }
  function comboDropdownFor(entry) { return comboAgent.panel(entry); }
  function closeCombobox(entry) { return comboAgent.close(entry); }

  // 日期类控件要按「人敲键盘」的顺序来：先真的聚焦，再写值、回车提交、失焦。
  // 成对的起止时间控件把状态存在自己内部，并且记着「当前编辑的是哪一行」——
  // 只改 value 再补一个合成 focus 事件，切不走这个活动行，值就会提交到别的段上。
  const DATE_DAY_HINT = /(yyyy|年)\s*[-/.年]?\s*(mm|月)\s*[-/.月]?\s*(dd|日)|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日/i;
  const DATE_MONTH_HINT = /(yyyy|年)\s*[-/.年]?\s*(mm|月)(?!\s*[-/.月]?\s*(dd|日))|\d{4}[-/.]\d{1,2}$|\d{4}年\d{1,2}月$/i;

  // 页面要精确到天还是月，从控件类型和写法上看，不信简历。
  function datePrecisionOf(element) {
    if (!(element instanceof HTMLInputElement)) {
      return "auto";
    }
    if (element.type === "date") {
      return "day";
    }
    if (element.type === "month") {
      return "month";
    }

    const probe = `${element.getAttribute("placeholder") || ""} ${String(element.value || "")}`.trim();
    if (/^yyyy$/i.test(probe)) return "year";
    if (DATE_DAY_HINT.test(probe)) {
      return "day";
    }
    if (DATE_MONTH_HINT.test(probe)) {
      return "month";
    }
    return "auto";
  }

  // Bind to the current input: explicit ARIA ownership or a unique newly opened portal.
  async function writeCalendarPanelDate(element, value, precision, entry) {
    const trace=(action,detail)=>{if(entry){entry.interactions??=[];entry.interactions.push({action,detail});}};
    const selector=`${skin(".ant-calendar-picker-container", ".ant-calendar")}, ${controlCatalog.selector('datePanel')}`;
    const panels=()=>{
      const all=Array.from(document.querySelectorAll(selector)).filter(n=>isVisible(n)&&!n.closest('[aria-hidden="true"]')&&!Array.from(n.classList).some(c=>/calendar-hidden$/.test(c)));
      return all.filter(n=>!all.some(other=>other!==n&&other.contains(n)));
    };
    const before=new Set(panels());let owned=null;
    const current=()=>{
      if(!element.isConnected)return null;
      const ids=new Set([element,element.parentElement,entry?.pickerRoot].filter(Boolean).flatMap(n=>`${n.getAttribute('aria-controls')||''} ${n.getAttribute('aria-owns')||''}`.split(/\s+/)).filter(Boolean));
      const linked=[...ids].map(id=>document.getElementById(id)).filter(n=>n&&isVisible(n));
      if(linked.length===1)return linked[0];
      if(linked.length>1)return null;
      if(owned?.isConnected&&isVisible(owned))return owned;
      const appeared=panels().filter(n=>!before.has(n));
      if(appeared.length===1){owned=appeared[0];return owned;}
      return null;
    };
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const waitFor=async predicate=>{for(let i=0;i<20;i++){const result=predicate();if(result)return result;await pause(80);}return null;};
    const visibleOne=(panel,css)=>Array.from(panel?.querySelectorAll(css)||[]).find(isVisible);
    const helpers=self.ResumeProAIHelpers;
    let target=helpers.normalizeDateForPrecision(value,precision),wanted=target.value;
    const fail=reason=>{trace('日历停止',reason);if(entry)entry.fillNote=reason;return {ok:false,value:wanted,padded:target.padded,reason};};
    const close=()=>{if(element.isConnected){element.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));element.blur();}};
    try{
      if(!element.isConnected)return fail('日期输入框已被替换');
      const trigger=entry?.hiddenInput?entry.pickerRoot:element;
      if(!trigger||!isVisible(trigger))return fail('未找到可见的日期点击目标');
      if(browserInputEnabled())await browserInput(trigger);else {trigger.focus();trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));trigger.click();}
      trace('打开日历','等待当前输入框关联的面板');
      let panel=await waitFor(current);
      if(!panel)return fail('未出现唯一关联的日历面板');
      const adapted=await self.ResumeProCalendarAgent.create({visible:isVisible,click:calendarClick}).fill({
        entry:entry||{},value,precision,panel:current,read:()=>entry?readBackValue(entry):element.value,close,trace,
        readPeer:entry?.rangePeer?()=>readBackValue(entry.rangePeer):undefined
      });
      if(adapted)return adapted;
      if(precision==='year'&&panel.querySelector('.atsx-date-picker-panel-body-year'))return await atsxDateAgent.fillYear(entry||{element},element,current,value);
      if(precision==='year') {
        const yy=String(value).match(/^(\d{4})(?:$|[-/年])/)?.[1];
        if(!yy)return fail('目标年份不明确');
        wanted=yy;
        const sameYear=()=>String(entry?readBackValue(entry):element.value).trim()===yy;
        for(let step=0;step<30&&!sameYear();step++) {
          panel=current();if(!panel)return fail('年份面板关闭，目标值未保留');
          const cells=Array.from(panel.querySelectorAll(skin('.ant-calendar-year-panel-cell'))).filter(n=>isVisible(n)&&!n.matches('[class*="disabled"],[aria-disabled="true"]'));
          if(!cells.length){const select=visibleOne(panel,skin('.ant-calendar-year-select'));if(!select)return fail('未找到年份选择面板');await calendarClick(select);await pause(180);continue;}
          const candidates=cells.filter(n=>n.textContent.trim()===yy);
          if(candidates.length===1){await calendarClick(candidates[0]);await pause(180);break;}
          if(candidates.length>1)return fail('年份候选不唯一');
          const years=cells.map(n=>Number(n.textContent.trim())).filter(Number.isFinite);
          const direction=Number(yy)<Math.min(...years)?'prev':'next';
          const next=visibleOne(panel,skin(`.ant-calendar-year-panel-${direction}-decade-btn`));
          if(!next)return fail('缺少年份翻页按钮');await calendarClick(next);await pause(180);
        }
        close();await pause(180);
        return sameYear()?{ok:true,value:yy,padded:false}:fail('年份选择后未保留目标值');
      }
      const monthMode=Boolean(visibleOne(panel,skin('.ant-calendar-month-panel')));
      if(monthMode)target=helpers.normalizeDateForPrecision(value,'month');
      else if(precision==='auto')target=helpers.normalizeDateForPrecision(value,'day');
      wanted=target.value;
      const parts=/^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(wanted);
      if(!parts)return fail('目标日期格式不明确');
      const yy=Number(parts[1]),mm=Number(parts[2]),dd=Number(parts[3]);
      trace('识别日历',monthMode?'月份面板':'日期面板');
      const same=()=>{const actual=entry?readBackValue(entry):String(element.value||'');return element.isConnected&&actual.split('-').length>=wanted.split('-').length&&sameDateAtPrecision(actual,wanted);};
      const input=visibleOne(panel,`${skin('.ant-calendar-input','.ant-calendar-month-panel-input')}, .el-date-editor input`);
      if(input&&!input.readOnly&&!input.disabled){
        if(browserInputEnabled())await browserInput(input,wanted,true);
        else {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,wanted);
        input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}));
        }
        trace('日历输入','已尝试面板输入，等待外部字段确认');await pause(180);
      }
      // Re-read the panel and header after each navigation; frameworks replace these nodes.
      for(let step=0;!same()&&step<60;step++){
        panel=current();if(!panel)return fail('日历关闭或失去关联，目标值未保留');
        const year=visibleOne(panel,monthMode?skin('.ant-calendar-month-panel-year-select'):skin('.ant-calendar-year-select'));
        const month=monthMode?null:visibleOne(panel,skin('.ant-calendar-month-select'));
        const shownYear=Number((year?.textContent||'').match(/\d{4}/)?.[0]);
        const shownMonth=monthMode?mm:Number((month?.textContent||'').match(/\d{1,2}/)?.[0]);
        if(!shownYear||!shownMonth)return fail('无法读取当前日历年月');
        if(shownYear===yy&&shownMonth===mm){
          const cells=Array.from(panel.querySelectorAll(monthMode?skin('.ant-calendar-month-panel-cell'):skin('.ant-calendar-cell'))).filter(n=>isVisible(n)&&!n.matches('[aria-disabled="true"],[class*="disabled"]'));
          const names=['一','二','三','四','五','六','七','八','九','十','十一','十二'];
          const candidates=cells.filter(n=>{
            const title=n.getAttribute('title')||'',text=n.textContent.trim();
            if(monthMode)return [wanted,`${yy}年${mm}月`,`${mm}月`,`${names[mm-1]}月`].includes(title)||text===`${mm}月`||text===`${names[mm-1]}月`;
            return [wanted,`${yy}年${mm}月${dd}日`,`${yy}-${mm}-${dd}`].includes(title);
          });
          if(candidates.length!==1)return fail(`目标日期格无法唯一确定（${candidates.length} 个候选）`);
          await calendarClick(candidates[0]);trace('选择日期格',monthMode?'选择目标月份':'选择目标日期');
          await waitFor(same);break;
        }
        const direction=shownYear<yy?'next':shownYear>yy?'prev':shownMonth<mm?'next':'prev';
        const unit=shownYear!==yy?'year':'month';
        const cls=monthMode?`.ant-calendar-month-panel-${direction}-year-btn`:`.ant-calendar-${direction}-${unit}-btn`;
        const button=visibleOne(panel,skin(cls));
        if(!button||button.matches('[disabled],[aria-disabled="true"]'))return fail('缺少可用的日历翻页按钮');
        await calendarClick(button);trace('日历翻页',unit==='year'?'切换年份':'切换月份');
        const changed=await waitFor(()=>{
          const p=current(),y=visibleOne(p,monthMode?skin('.ant-calendar-month-panel-year-select'):skin('.ant-calendar-year-select'));
          const m=monthMode?null:visibleOne(p,skin('.ant-calendar-month-select'));
          return y&&(Number((y.textContent||'').match(/\d{4}/)?.[0])!==shownYear||(!monthMode&&Number((m?.textContent||'').match(/\d{1,2}/)?.[0])!==shownMonth));
        });
        if(!changed)return fail('点击翻页后日历年月未改变');
      }
      close();await pause(180);
      if(!same())return fail('日历操作后输入框未保留目标日期');
      trace('日历核对','关闭面板后目标值仍保留');return {ok:true,padded:target.padded,value:wanted};
    }finally{close();}
  }

  // 站点显示月精度（2027-06）时拿 2027-06-01 去比会误判成没写进去。
  // 两边归一到能比的最粗精度：任一边缺日就只比年月，缺月就只比年。
  function sameDateAtPrecision(actual, wanted) {
    const a = String(actual ?? "").trim().split("-");
    const w = String(wanted ?? "").trim().split("-");
    if (!a[0] || !w[0] || a[0] !== w[0]) {
      return false;
    }
    const depth = Math.min(a.length, w.length);
    for (let i = 1; i < depth; i += 1) {
      if (Number(a[i]) !== Number(w[i])) {
        return false;
      }
    }
    return true;
  }

  function writeDateValue(element, value, inputType, precision = "auto") {
    const helpers = self.ResumeProAIHelpers;
    const targeted = helpers?.normalizeDateForPrecision
      ? helpers.normalizeDateForPrecision(value, precision)
      : { value: String(value ?? "").trim(), precision: "auto", padded: false };
    const normalized = targeted.precision === "auto"
      ? (helpers?.normalizeDateValue?.(targeted.value, inputType) ?? targeted.value)
      : targeted.value;
    const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value");

    element.focus?.();
    if (descriptor?.set) {
      descriptor.set.call(element, normalized);
    } else {
      element.value = normalized;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur?.();

    return { ok: element.value === normalized, padded: targeted.padded, value: normalized };
  }

  function setElementValue(element, value) {
    if (element && typeof element === "object" && element.kind === "combobox") {
      return fillCombobox(element, value);
    }

    if (element && typeof element === "object" && element.kind === "radio") {
      const radioOptions = element.elements.map((radio) => ({ value: radio.value, text: getRadioOptionLabel(radio), disabled: radio.disabled }));
      const radioIndex = self.ResumeProAIHelpers?.findSelectOptionIndex?.(radioOptions, value, element.meta) ?? -1;
      const matchedRadio = radioIndex >= 0 ? element.elements[radioIndex] : null;

      if (!matchedRadio) {
        return false;
      }

      matchedRadio.checked = true;
      matchedRadio.dispatchEvent(new Event("input", { bubbles: true }));
      matchedRadio.dispatchEvent(new Event("change", { bubbles: true }));
      matchedRadio.click();
      return true;
    }

    const calendarEntry = element?.kind === "element" ? element : null;
    const pickerType = (element && typeof element === "object" && element.kind === "element") ? element.pickerType : null;
    const pickerInputType = (element && typeof element === "object" && element.kind === "element") ? (element.pickerInputType || "date") : "date";
    const dateLike = (element && typeof element === "object" && element.kind === "element") ? Boolean(element.dateLike) : false;

    if(calendarEntry&&!dateLike&&!pickerType&&calendarEntry.element instanceof HTMLInputElement){
      const root=structuralChoiceRoot(calendarEntry.element);
      if(root)return fillCombobox(promoteStructuralChoice(calendarEntry,root),value);
    }

    if (element && typeof element === "object" && element.kind === "element") {
      element = element.element;
    }

    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      const wanted = self.ResumeProAIHelpers.checkboxState(value, calendarEntry?.meta?.label || getCheckboxLabel(element));
      if (wanted === null) { if(calendarEntry)calendarEntry.fillNote='复选框不接受日期或文本';return false; }
      if (element.checked === wanted) return true;
      return (async()=>{
        try {
          if(browserInputEnabled())await browserInput(element);else element.click();
          await new Promise(resolve=>window.setTimeout(resolve,180));
          if(!element.isConnected&&calendarEntry?.meta){
            const fresh=refreshFieldEntry(calendarEntry.meta,calendarEntry);
            if(fresh?.element?.type==='checkbox')calendarEntry.element=element=fresh.element;
          }
          return element.isConnected && element.type==='checkbox' && element.checked === wanted;
        } catch(error) {
          if(calendarEntry)calendarEntry.fillNote=error.message;return false;
        }
      })();
    }

    if(calendarEntry?.atsxPeriod)return atsxDateAgent.fillPeriod(calendarEntry,value);
    if(calendarEntry&&udDateAgent.recognizes(calendarEntry))return udDateAgent.fill(calendarEntry,value,datePrecisionOf(element));

    // Ant 的日期框是 readonly 的，直接写值不认；值只能从日历面板进。
    if (calendarEntry?.displayDate || (element instanceof HTMLInputElement && !['date','month','datetime-local','time'].includes(element.type) && element.closest(`${skin(".ant-calendar-picker")}, ${controlCatalog.selector('dateRoot')}, [class*='date-picker']`))) {
      return writeCalendarPanelDate(element, value, calendarEntry?.displayDate ? "month" : datePrecisionOf(element), calendarEntry);
    }

    if (element instanceof HTMLInputElement && ["date", "month", "datetime-local", "time"].includes(element.type)) {
      const precision = element.type === "date" ? "day" : element.type === "month" ? "month" : "auto";
      return writeDateValue(element, value, element.type, precision);
    }

    if (element instanceof HTMLInputElement && (pickerType === "antd" || pickerType === "element" || pickerType === "generic")) {
      const precision = pickerInputType === "date" ? "day" : pickerInputType === "month" ? "month" : "auto";
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return new Promise((resolve) => {
        window.setTimeout(() => {
          try {
            resolve(writeDateValue(element, value, pickerInputType, precision));
          } catch (_) {
            resolve({ ok: false, padded: false });
          }
        }, 150);
      });
    }

    // 认不出容器类名的日期框（占位符写着 YYYY-MM、或标签是起止/开始/结束时间这类）
    // 会落到下面的普通文本框分支 —— 那条路不聚焦也不提交，正是起止时间串行的地方。
    if (dateLike && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      return writeDateValue(element, value, "date", datePrecisionOf(element));
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      // Some unlabeled/hash-class autocomplete lists only enter the DOM after typing.
      // Upgrade from concrete, locally owned list evidence, not from the typed value.
      if(calendarEntry&&element instanceof HTMLInputElement){
        const root=structuralChoiceRoot(element);
        if(root)return fillCombobox(promoteStructuralChoice(calendarEntry,root),value);
        if(/学校|院校|专业/.test(calendarEntry.meta?.label||getFieldLabel(element))){
          return (async()=>{
            for(let attempt=0;attempt<5;attempt++){
              await new Promise(resolve=>setTimeout(resolve,100));
              if(!element.isConnected){
                const next=refreshFieldEntry(calendarEntry.meta,calendarEntry);
                if(!next)return false;
                Object.assign(calendarEntry,next);
                if(next.kind==='combobox')return verifyFilledValue(calendarEntry,value,'combobox')||fillCombobox(calendarEntry,value);
                element=next.element;
              }
              const root=structuralChoiceRoot(element);
              if(root)return fillCombobox(promoteStructuralChoice(calendarEntry,root),value);
            }
            return element.value===String(value);
          })();
        }
      }
      return true;
    }

    if (element instanceof HTMLSelectElement) {
      const selectOptions = Array.from(element.options).map((option) => ({ value: option.value, text: option.text, disabled: option.disabled }));
      const optionIndex = self.ResumeProAIHelpers?.findSelectOptionIndex?.(selectOptions, value, calendarEntry?.meta) ?? -1;
      const matchedOption = optionIndex >= 0 ? element.options[optionIndex] : null;

      if (!matchedOption) {
        return false;
      }

      // 走原型上的 setter：有些框架在实例上拦了 value，直接赋值会被吞掉。
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(element, matchedOption.value);
      } else {
        element.value = matchedOption.value;
      }
      // 几个选项 value 相同时（常见的是一串空值），按 value 赋值会落到第一个，按下标补一次。
      if (element.selectedIndex !== optionIndex) {
        element.selectedIndex = optionIndex;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return element.selectedIndex === optionIndex;
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    return false;
  }

  function highlightFilledField(fieldEntry, value, variant = null) {
    getHighlightTargets(fieldEntry, value).forEach((target) => {
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (!isInViewport(target)) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        queueFieldHighlightWhenVisible(target, 0, variant);
        return;
      }

      applyFieldHighlight(target, variant);
    });
  }

  function queueFieldHighlightWhenVisible(target, attempt = 0, variant = null) {
    clearFieldHighlightTimer(target);
    const timer = window.setTimeout(() => {
      if (isInViewport(target) || attempt >= 18) {
        applyFieldHighlight(target, variant);
        return;
      }

      queueFieldHighlightWhenVisible(target, attempt + 1, variant);
    }, 100);
    fieldHighlightTimers.set(target, timer);
  }

  function applyFieldHighlight(target, variant = null) {
    const className = variant === "drift" ? FIELD_DRIFT_CLASS : FIELD_HIGHLIGHT_CLASS;
    clearFieldHighlightTimer(target);
    target.classList.remove(FIELD_HIGHLIGHT_CLASS, FIELD_DRIFT_CLASS);
    void target.offsetWidth;
    target.classList.add(className);

    const timer = window.setTimeout(() => {
      target.classList.remove(FIELD_HIGHLIGHT_CLASS, FIELD_DRIFT_CLASS);
      fieldHighlightTimers.delete(target);
    }, variant === "drift" ? 10000 : 2800);
    fieldHighlightTimers.set(target, timer);
  }

  function clearFieldHighlightTimer(target) {
    if (!fieldHighlightTimers.has(target)) {
      return;
    }

    window.clearTimeout(fieldHighlightTimers.get(target));
    fieldHighlightTimers.delete(target);
  }

  function getHighlightTargets(fieldEntry, value) {
    if (fieldEntry?.kind === "combobox") {
      return [fieldEntry.trigger || fieldEntry.root];
    }

    if (fieldEntry?.kind === "radio") {
      const trimmedValue = String(value || "").trim();
      const matchedRadio = fieldEntry.elements.find((radio) => {
        const optionText = getRadioOptionLabel(radio);
        return optionText === trimmedValue || radio.value === trimmedValue;
      });

      if (!matchedRadio) {
        return [];
      }

      return [matchedRadio.labels?.[0] || matchedRadio.closest("label") || matchedRadio];
    }

    const element = fieldEntry?.kind === "element" ? fieldEntry.element : fieldEntry;

    if (!(element instanceof HTMLElement)) {
      return [];
    }

    if (fieldEntry?.pickerType) {
      return [element.closest(".ant-picker, .el-date-editor, [class*='date-picker']") || element];
    }

    return [element];
  }

  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0
      && rect.left >= 0
      && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight)
      && rect.right <= (window.innerWidth || document.documentElement.clientWidth);
  }

  function injectFieldHighlightStyles() {
    if (document.getElementById(FIELD_HIGHLIGHT_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = FIELD_HIGHLIGHT_STYLE_ID;
    style.textContent = FIELD_HIGHLIGHT_STYLE_TEXT;
    (document.head || document.documentElement).appendChild(style);
  }

  function profileResumeFields() {
    return self.ResumeProProfile?.profileToResumeFields(state.currentStore?.profile) || [];
  }

  function buildProfileChipsHtml(profileFields) {
    const groups = new Map();

    profileFields.forEach((field) => {
      if (!groups.has(field.group)) groups.set(field.group, []);
      groups.get(field.group).push(field);
    });

    return Array.from(groups, ([name, groupFields]) => `
      <section class="resume-pro__group">
        <div class="resume-pro__group-name">我的信息 · ${escapeHtml(name)}</div>
        <div class="resume-pro__chips">
          ${groupFields.map((field) => `
            <button
              class="resume-pro__chip"
              type="button"
              data-chip-id="${escapeHtml(`profile:${name}:${field.key}`)}"
              data-value="${escapeHtml(field.value)}"
              title="${escapeHtml(field.value)}"
            >
              ${escapeHtml(field.key)}
            </button>
          `).join("")}
        </div>
      </section>
    `).join("");
  }

  // 填完之后，网页上没匹配上、也还空着的字段，问一句要不要加进「我的信息」。
  // 这样档案里的字段来自真实表单，用户补一次内容，下次同样的字段就能自动填。
  function offerUnansweredFields(candidates, resumeFields) {
    const api = self.ResumeProProfile;
    const card = shadowRoot?.querySelector("#resume-pro-profile-offer");
    if (!api || !card) return;

    const labels = api.pickUnansweredLabels(candidates, api.knownFieldKeys(state.currentStore?.profile, resumeFields));

    if (!labels.length) {
      closeProfileOffer();
      return;
    }

    state.profileOfferLabels = labels;
    state.profileOfferFields = resumeFields;
    state.profileOfferCandidates = candidates;
    const shown = labels.slice(0, 5).join("、");
    card.querySelector("#resume-pro-profile-offer-text").textContent =
      `网页上还有 ${labels.length} 个字段空着：${shown}${labels.length > 5 ? " 等" : ""}。加到「我的信息」并补上内容，下次就能自动填。`;
    card.hidden = false;
  }

  function closeProfileOffer() {
    const card = shadowRoot?.querySelector("#resume-pro-profile-offer");
    if (card) card.hidden = true;
    state.profileOfferLabels = [];
    state.profileOfferFields = [];
    state.profileOfferCandidates = [];
  }

  async function addUnansweredToProfile() {
    // 卡片出来之后用户可能已经手动填了几个，点的时候按网页现在的样子再挑一遍。
    const candidates = state.profileOfferCandidates || [];
    const labels = (state.profileOfferLabels || []).filter((label) => candidates.some((candidate) =>
      String(candidate.label ?? "").trim() === label && candidate.entry && !hasExistingValue(candidate.entry)));
    const resumeFields = state.profileOfferFields;

    if (!labels.length) {
      closeProfileOffer();
      showStatus("这些字段已经在网页上填好了。", "success");
      return;
    }

    try {
      // 用户点了才写，并且只读写 profile 这一个键，不碰模板和 AI 配置。
      const stored = await chrome.storage.local.get("profile");
      const { profile, added, full } = self.ResumeProProfile.addPendingFields(stored.profile, labels, resumeFields);

      if (!added) {
        if (!full) closeProfileOffer();
        showStatus(full ? "补充字段已经满了，先在管理面板里删掉用不上的。" : "这些字段「我的信息」里已经有了。", full ? "error" : "success");
        return;
      }

      await chrome.storage.local.set({ profile });
      // 写成功才收起卡片；写失败时卡片留着，可以直接再点一次。
      closeProfileOffer();
      showStatus(`已把 ${added} 个字段加到「我的信息」，在管理面板里补上内容。`, "success", true);
      await openManager("profile");
    } catch (error) {
      showStatus(`没有加进去：${error.message || "写入失败"}`, "error");
    }
  }

  // --- 反向采集：把网页上已经填好的内容补进模板 ------------------------------------
  //
  // 只读页面，不点击网页任何控件，也不发 AI 请求 —— 简历内容不出本机浏览器。
  // 挑出来的字段只新增；模板或「我的信息」里已经有名字、或者语义上等价的，只在
  // 「已存在」里报告，不改动用户已经存好的值。


  function readFieldValue(entry, field) {
    if (!entry) {
      return "";
    }

    if (entry.kind === "combobox") {
      return readBackValue(entry);
    }

    if (entry.kind === "radio") {
      const checked = (entry.elements || []).find((element) => element.checked);
      return checked ? sanitizeLabelText(getRadioOptionLabel(checked)) : "";
    }

    const element = entry.element;
    if (!element?.isConnected) {
      return "";
    }
    if(udDateAgent.recognizes(entry))return udDateAgent.read(entry);

    if (element.type === "checkbox") {
      return element.checked ? sanitizeLabelText(getFieldLabel(element) || element.value) : "";
    }

    if (element instanceof HTMLSelectElement) {
      const option = element.options[element.selectedIndex];
      const optionText = sanitizeLabelText(option?.text);
      // 存人看得懂的选项文本，不存 option.value：导出成 Excel 之后这格要能自己读懂。
      if (!optionText || self.ResumeProAIHelpers?.isPlaceholderOption?.({ value: element.value, text: optionText, disabled: option.disabled })) {
        return "";
      }
      return optionText;
    }

    const raw = String(element.value ?? element.textContent ?? "").trim();
    if (!raw) {
      return "";
    }

    if (field?.inputType === "date-picker") {
      return self.ResumeProAIHelpers?.normalizeDateValue?.(raw, field.pickerInputType) || raw;
    }

    return raw;
  }

  function readFilledFields() {
    const { fields, fieldMap } = scanFillableFields();
    const helpers = self.ResumeProAIHelpers;

    return fields.reduce((filled, field, index) => {
      if (String(field.inputType || "").toLowerCase() === "password") {
        return filled;
      }

      const entry = fieldMap.get(field.fieldId);
      let value = readFieldValue(entry, field);
      if(field.datePart){
        if(field.dateRangeUnresolved)return filled;
        const parts=fields.filter(other=>field.rangeId?other.rangeId===field.rangeId&&other.rangeRole===field.rangeRole
          :field.datePointId&&other.datePointId===field.datePointId);
        if(parts[0]!==field)return filled;
        value=rangeEndpointValue(parts,field.rangeRole,part=>readFieldValue(fieldMap.get(part.fieldId),part));
      }
      if (!value) {
        return filled;
      }

      const label = sanitizeLabelText(field.label || "");
      if (!label) {
        // 标签取不到（或被判成值而清空）的字段不采集：placeholder 多半是「请输入」，
        // name 是英文结构名，都不适合当模板里的字段名。
        return filled;
      }

      filled.push({
        label,
        group: field.group || "",
        value,
        inputType: field.inputType,
        recordIndex: field.recordIndex,
        recordTotal: field.recordTotal,
        recordSignature: field.recordSignature,
        // Semantic matching uses the field itself; grouping above comes only from section headings.
        semantic: helpers?.inferFieldSemantic?.({ ...field, group: "" }) || "",
        order: index
      });
      return filled;
    }, []);
  }

  // 一级分类只能看板块标题。findNearestGroupLabel 是给 AI 当上下文提示用的，
  // 它返回的是最近的 label 文本，当分组名会用字段名建出一个分组来。
  function collectSectionHeadings() {
    // Page-wide form/main containers can contain every section; their first heading is not this field's heading.
    // Recruitment pages often render headings as plain styled div/span nodes, without
    // a title class or heading role. Accept only exact known headings outside controls.
    const selector='h1,h2,h3,h4,legend,[role="heading"],[class*="title"],[class*="Title"],div,span,p,strong';
    const candidates=Array.from(document.querySelectorAll(selector)).filter(n=>
      /^(基本信息|个人信息|求职意向|教育经历|教育背景|教育经验|工作经历|工作经验|实习经历|实习经验|项目经历|项目经验|科研经历|研究经历|语言能力|语言技能|语言能力及证书|证书|自我描述|自我评价|个人评价|获奖经历|荣誉奖励|获奖情况|获奖|奖项|奖励荣誉|荣誉奖项|奖励情况|校园经历|在校职务|校内职务|在校经历|社团经历|社会实践|专业技能|论文发表|论文期刊)$/.test(sanitizeLabelText(n.textContent))
      &&!n.closest(`#${SIDEBAR_ID},nav,[role="navigation"],[role="tablist"],[class*="navigation"],[class*="Navigation"],[class*="nav-"],[class*="menu"],[class*="Menu"],label,input,textarea,select,button,[role="option"],[role="treeitem"],.field-label,.phoenix-form-item-label-content,${COMBO_ROOT_SELECTOR},${CONTROL_POPUP_SELECTOR}`)
      &&!n.querySelector(`input,textarea,select,${COMBO_ROOT_SELECTOR}`)
      &&!n.matches('a,button,[role="tab"]')&&isVisible(n));
    return candidates.filter(n=>{
      if(candidates.some(other=>other!==n&&n.contains(other)))return false;
      // A normal field can itself be called “工作经验”. Moka's single field cards
      // use hashed apply-field-* classes; the plural apply-fields-* is a section.
      // A field caption must never rename all fields following it to “工作经历”.
      if(n.closest(FORM_ITEM_SELECTOR))return false;
      for(let scope=n.parentElement,depth=0;scope&&scope!==document.body&&depth<8;scope=scope.parentElement,depth++){
        if(String(scope.className||'').split(/\s+/).some(token=>/^apply-field(?:[-_]|$)/.test(token)))return false;
        if(scope.querySelector(`h1,h2,h3,h4,[role="heading"]`))break;
      }
      for(let scope=n.parentElement,depth=0;scope&&scope!==document.body&&depth<8;scope=scope.parentElement,depth++){
        if(scope.querySelector(`input,textarea,select,${COMBO_ROOT_SELECTOR}`))break;
        if(new Set(candidates.filter(other=>scope.contains(other)).map(other=>sanitizeLabelText(other.textContent))).size>1)return false;
      }
      return true;
    });
  }
  function findSectionHeading(element, headings) {
    if (!element) return "";
    const candidates=(headings || collectSectionHeadings()).filter(n=>n.compareDocumentPosition(element)&Node.DOCUMENT_POSITION_FOLLOWING);
    for(let scope=element.parentElement;scope&&scope!==document.body;scope=scope.parentElement){
      const local=candidates.filter(n=>scope.contains(n));
      if(local.length){
        const heading=sanitizeLabelText(local.at(-1).textContent);
        const aliases={'教育经验':'教育经历','工作经验':'工作经历','实习经验':'实习经历','项目经验':'项目经历','研究经历':'科研经历',
          '在校职务':'校园经历','校内职务':'校园经历','在校经历':'校园经历','社团经历':'校园经历','社会实践':'校园经历',
          '自我描述':'自我评价','个人评价':'自我评价'};
        return aliases[heading]||heading;
      }
    }
    return '';

  }

  async function handleCollectFillClick(event) {
    const button = event.currentTarget;
    if (button.disabled || shadowRoot?.querySelector("#resume-pro-ai-fill")?.disabled || !requireContext()) return;
    const template = getActiveTemplate(state.currentStore);
    if (!template) { showStatus("请先在资料管理页新建或导入资料。", "error"); return; }
    button.disabled = true;
    let stopButton;
    try {
      const result = await chrome.runtime.sendMessage({type: "RESUME_COLLECT", templateId: template.id, fields: readFilledFields()});
      if (!result?.success) throw new Error(result?.error || "无法保存补充内容。");
      let note = '';
      if (result.added) {
        button.textContent = 'AI 正在归纳…';
        const controller = new AbortController();
        stopButton = document.createElement('button');
        stopButton.type = 'button'; stopButton.className = 'resume-pro__manager-button';
        stopButton.textContent = '停止等待 AI 归纳';
        stopButton.addEventListener('click', () => controller.abort());
        button.insertAdjacentElement('afterend', stopButton);
        showStatus('原始内容已保存，AI 正在建议分类与经历归属…', 'success', true);
        try {
          const organized = await self.ResumeProCollectionAI.organize(template.id,result.ids,{
            signal:controller.signal,
            onProgress:seconds=>showStatus(`AI 正在归纳，已等待 ${seconds} 秒。${seconds>=60?'模型仍未返回，可继续等待或停止等待。':'原始采集内容已保存。'}`, 'success', true)
          });
          note = `AI 已归纳 ${organized.organized} 项，请核对建议。`;
        } catch (error) { note = `AI 归纳未完成：${error.message} 可在待确认列表重试。`; }
      }
      showStatus(`采集了 ${result.added} 项补充内容。${note}确认后才用于填写。`, 'success', true);
      await openManager("inbox");
    } catch (error) { showStatus(error.message, "error", true); }
    finally { stopButton?.remove(); button.disabled = false; button.textContent = "采集到资料树"; }
  }

  function countTemplateFields(template) {
    return flattenTemplateFields(template).length;
  }

  function flattenTemplateFields(template) {
    return template.groups.flatMap((group) => group.fields.filter(field => String(field.value ?? "").trim() && field.review?.status !== 'pending').map((field) => ({
      group: group.name,
      groupId: group.id,
      key: field.key,
      label: field.label,
      value: field.value,
      fieldId: field.id,
      recordId: field.recordId,
      recordName: group.records?.find(record => record.id === field.recordId)?.name || ""
    })));
  }

  function getRadioOptionLabel(radio) {
    const directLabel = radio.labels?.[0]?.textContent?.trim();

    if (directLabel) {
      return directLabel;
    }

    const wrappingLabel = radio.closest("label")?.textContent?.trim();
    if (wrappingLabel) {
      return wrappingLabel;
    }

    return radio.value?.trim() || "";
  }

  function findNearestGroupLabel(element) {
    const sectionSelectors = ["fieldset", "[role='group']", ".form-item", ".ant-form-item", "tr", "li", "section", "td"];

    for (const selector of sectionSelectors) {
      const container = element.closest(selector);

      if (!container) {
        continue;
      }

      const labelCandidate = container.querySelector("legend, label, th, .label, .form-label, .ant-form-item-label");
      const text = labelCandidate?.textContent?.trim().replace(/[*\s]+$/g, "").trim();

      if (text && text.length < 40) {
        return text;
      }
    }

    return "";
  }

  function sanitizeLabelText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^\*+/, "")
      .replace(/\*+$/g, "")
      .trim();
  }

  async function openManager(tab = "") {
    try {
      const result = await chrome.runtime.sendMessage({ type: "OPEN_MANAGER", tab });
      if (!result?.opened) {
        showStatus(result?.error || "无法打开管理面板，请从浏览器工具栏点击 ApplyFill。", "error");
      }
    } catch {
      showStatus("无法打开管理面板，请从浏览器工具栏点击 ApplyFill。", "error");
    }
  }

  function isFillTarget(target) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  function getActiveTemplate(store) {
    if (!store?.templates?.length) {
      return null;
    }

    return store.templates.find((template) => template.id === store.activeTemplateId) || store.templates[0];
  }

  function showStatus(message, variant, persist = false) {
    const statusElement = shadowRoot?.querySelector("#resume-pro-status");

    if (!statusElement) {
      return;
    }

    statusElement.textContent = message;
    statusElement.className = `resume-pro__status is-visible is-${variant}`;

    if (state.statusTimer) {
      clearTimeout(state.statusTimer);
      state.statusTimer = null;
    }

    if (persist) {
      return;
    }

    state.statusTimer = window.setTimeout(() => {
      statusElement.className = "resume-pro__status";
      statusElement.textContent = "";
    }, 2400);
  }

  function startDrag(event) {
    if (event.target.closest("button, select, input")) {
      return;
    }

    const host = document.getElementById(SIDEBAR_ID);
    const rect = host.getBoundingClientRect();
    state.dragging = true;
    state.dragOffsetX = event.clientX - rect.left;
    state.dragOffsetY = event.clientY - rect.top;
    shadowRoot?.querySelector(".resume-pro")?.classList.add("is-dragging");
  }

  function onDrag(event) {
    if (!state.dragging) {
      return;
    }

    const sidebar = document.getElementById(SIDEBAR_ID);
    const width = sidebar.offsetWidth;
    const height = sidebar.offsetHeight;
    const nextLeft = clamp(event.clientX - state.dragOffsetX, 12, window.innerWidth - width - 12);
    const nextTop = clamp(event.clientY - state.dragOffsetY, 12, window.innerHeight - height - 12);

    sidebar.style.left = `${nextLeft}px`;
    sidebar.style.top = `${nextTop}px`;
    sidebar.style.right = "auto";
  }

  function stopDrag() {
    if (!state.dragging) {
      return;
    }

    state.dragging = false;
    shadowRoot?.querySelector(".resume-pro")?.classList.remove("is-dragging");
    persistSidebarUiState();
  }

  function updateCollapseButton(sidebar = shadowRoot?.querySelector(".resume-pro")) {
    const collapseButton = sidebar?.querySelector(".resume-pro__collapse");
    if (!collapseButton) {
      return;
    }

    const collapsed = sidebar.classList.contains("is-collapsed");
    collapseButton.textContent = collapsed ? "+" : "−";
    collapseButton.setAttribute("aria-label", collapsed ? "展开助手" : "折叠助手");
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
  }

  function readSidebarUiState() {
    const host = document.getElementById(SIDEBAR_ID);
    const sidebar = shadowRoot?.querySelector(".resume-pro");
    if (!host || !sidebar) {
      return self.ResumeProSidebarState.normalize(state.sidebarUiState);
    }

    // The host uses position: fixed, so these are viewport coordinates unless a
    // page deliberately establishes a transformed containing block.
    const rect = host.getBoundingClientRect();
    return self.ResumeProSidebarState.normalize({
      collapsed: sidebar.classList.contains("is-collapsed"),
      left: rect.left,
      top: rect.top
    });
  }

  function applySidebarUiState() {
    const host = document.getElementById(SIDEBAR_ID);
    const sidebar = shadowRoot?.querySelector(".resume-pro");
    if (!host || !sidebar) {
      return;
    }

    const uiState = self.ResumeProSidebarState.normalize(state.sidebarUiState);
    sidebar.classList.toggle("is-collapsed", uiState.collapsed);
    updateCollapseButton(sidebar);

    if (uiState.left === null || uiState.top === null) {
      host.style.removeProperty("left");
      host.style.top = `${SIDEBAR_DEFAULT_TOP}px`;
      host.style.right = `${SIDEBAR_DEFAULT_RIGHT}px`;
      state.sidebarUiState = uiState;
      return;
    }

    const rect = host.getBoundingClientRect();
    const constrained = self.ResumeProSidebarState.constrain(
      uiState,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    host.style.left = `${constrained.left}px`;
    host.style.top = `${constrained.top}px`;
    host.style.right = "auto";
    state.sidebarUiState = constrained;
  }

  function constrainSidebarToViewport() {
    const current = self.ResumeProSidebarState.normalize(state.sidebarUiState);
    if (current.left === null || current.top === null) {
      // Keep the untouched default anchored to the right edge as the viewport changes.
      state.sidebarUiState = current;
      applySidebarUiState();
      return false;
    }

    // A resize only pulls the sidebar back into view for this session. It is
    // deliberately not persisted: a window the user shrank for a moment should not
    // overwrite the position they chose on a larger one.
    state.sidebarUiState = readSidebarUiState();
    applySidebarUiState();
    return !self.ResumeProSidebarState.equal(current, state.sidebarUiState);
  }

  function persistSidebarUiState() {
    const previous = self.ResumeProSidebarState.normalize(state.sidebarUiState);
    state.sidebarUiState = readSidebarUiState();
    applySidebarUiState();
    if (self.ResumeProSidebarState.equal(previous, state.sidebarUiState)) {
      return;
    }
    StorageService.setSidebarUiState(state.sidebarUiState).catch(() => {});
  }

  function clamp(value, min, max) {
    return max < min ? 0 : Math.min(Math.max(value, min), max);
  }

  function inferPickerInputType(container, inner) {
    const cls = container.className || "";
    const placeholder = (inner.getAttribute("placeholder") || "").toLowerCase();
    if (/time/i.test(cls) || /时间|hh:mm/.test(placeholder)) return "time";
    if (/month/i.test(cls) || /年月|月份|month/.test(placeholder)) return "month";
    if (/datetime/i.test(cls) || /日期.*时间|datetime/.test(placeholder)) return "datetime-local";
    return "date";
  }

  function isVisible(element) {
    const styles = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return styles.display !== "none"
      && styles.visibility !== "hidden"
      && !element.closest('[aria-hidden="true"],[inert]')
      && rect.width > 0
      && rect.height > 0;
  }

  function normalizeStore(rawState) {
    const templates = Array.isArray(rawState.templates)
      ? rawState.templates.map(normalizeTemplate).filter(Boolean)
      : [];

    const activeTemplateId = typeof rawState.activeTemplateId === "string"
      ? rawState.activeTemplateId
      : "";

    return {
      templates,
      activeTemplateId: templates.some((template) => template.id === activeTemplateId)
        ? activeTemplateId
        : templates[0]?.id || "",
      aiConfig: {
        apiUrl: String(rawState.aiConfig?.apiUrl ?? "https://api.openai.com/v1/chat/completions").trim(),
        model: String(rawState.aiConfig?.model ?? "gpt-4o-mini").trim(),
        apiKey: String(rawState.aiConfig?.apiKey ?? "")
      },
      profile: self.ResumeProProfile
        ? self.ResumeProProfile.normalizeProfile(rawState.profile)
        : { values: {}, family: [], custom: [] }
    };
  }

  function normalizeTemplate(template) {
    return self.ResumeProTree.normalizeTemplate(template);
  }

  // 扩展被重新加载或更新之后，页面里这份旧脚本的 chrome.* 全部会抛
  // 「Extension context invalidated」。诊断面板是在 finally 里渲染的，
  // 在那里抛异常会变成未处理的 promise 拒绝，所以版本号必须安全取。
  function pluginVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (_) {
      return "?";
    }
  }

  function contextAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch (_) {
      return false;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // --- Desktop link ---------------------------------------------------------
  //
  // The sidebar reads the page and shows the result; the service worker owns the native
  // messaging port and both queues. Content scripts cannot open that port at all, so every
  // desktop operation is a message.
  //
  // Extraction and URL redaction run here rather than in the worker because the worker has
  // no DOM, and because §5.2 puts the credential stripping before anything leaves the page.

  let desktopModules = null;
  let pendingFields = null;
  // The finished fill the card is offering to archive, and a copy of the template it used.
  // Held only until the user answers; the template copy leaves only if the box is ticked.
  let pendingFill = null;
  let pendingFillTemplate = null;

  async function loadDesktopModules() {
    if (!desktopModules) {
      const [extract, copy, fillrecords, snapshot] = await Promise.all([
        import(chrome.runtime.getURL("link/extract.mjs")),
        import(chrome.runtime.getURL("link/copy.mjs")),
        import(chrome.runtime.getURL("link/fillrecords.mjs")),
        import(chrome.runtime.getURL("link/snapshot.mjs"))
      ]);
      desktopModules = { extract, copy, fillrecords, snapshot };
    }
    return desktopModules;
  }

  function bindDesktopEvents(sidebar) {
    sidebar.querySelector("#resume-pro-save-job")?.addEventListener("click", handleSaveJobClick);
    sidebar.querySelector("#resume-pro-confirm-submit")?.addEventListener("click", handleConfirmSubmitClick);
    sidebar.querySelector("#resume-pro-save-cancel")?.addEventListener("click", closeSaveForm);
    sidebar.querySelector("#resume-pro-fill-record-save")?.addEventListener("click", handleRecordFillClick);
    sidebar.querySelector("#resume-pro-fill-record-skip")?.addEventListener("click", closeFillRecord);
    sidebar.querySelector("#resume-pro-save-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitSaveForm({ force: false });
    });
    refreshPendingList();
  }

  async function handleSaveJobClick() {
    const form = shadowRoot?.querySelector("#resume-pro-save-form");
    if (!form) return;

    try {
      const { extract } = await loadDesktopModules();
      const fields = extract.extractJobFields(document, location.href);
      form.querySelector("#resume-pro-save-company").value = fields.company;
      form.querySelector("#resume-pro-save-title").value = fields.title;
      form.querySelector("#resume-pro-save-location").value = fields.location;
      form.querySelector("#resume-pro-save-url").value = fields.sourceUrl;
      pendingFields = fields;
      const note = form.querySelector("#resume-pro-save-note");
      // Blanks are expected: nothing is guessed. Saying so is what stops a user from
      // assuming the extension already knows the employer.
      note.textContent = fields.company
        ? "请核对，缺的可以自己补。"
        : "这个页面没有声明公司名，请手动填写；插件不会替你猜。";
      form.hidden = false;
      setDesktopStatus(null);
    } catch (error) {
      setDesktopStatus({ tone: "warn", text: "读取页面信息失败，请手动填写后再保存。" });
    }
  }

  // Confirming a submission is its own act: it has nothing to do with whether the AI fill
  // worked, and nothing to do with having saved the posting a moment ago. The application is
  // chosen from the desktop's own candidates rather than remembered here, so the plugin never
  // holds a stale application id across a restore.
  async function handleConfirmSubmitClick() {
    const { extract, copy } = await loadDesktopModules();
    const fields = extract.extractJobFields(document, location.href);
    if (!fields.company) {
      setDesktopStatus({ tone: 'warn', text: '这个页面看不出是哪家公司，请先在桌面里确认投递。' });
      return;
    }

    let candidates;
    try {
      candidates = await chrome.runtime.sendMessage({ type: "DESKTOP_CANDIDATES_FOR", fields });
    } catch {
      candidates = null;
    }
    if (candidates?.status !== "ok") {
      setDesktopStatus(copy.describeConfirmResult({ status: "pending" }));
      return;
    }

    const options = [...candidates.exact, ...candidates.sameCompany];
    if (!options.length) {
      setDesktopStatus({ tone: 'warn', text: '桌面里还没有这家公司的申请，请先保存岗位。' });
      return;
    }

    const box = shadowRoot?.querySelector("#resume-pro-candidates");
    const list = shadowRoot?.querySelector("#resume-pro-candidate-list");
    shadowRoot.querySelector("#resume-pro-candidates-note").textContent = "这次投递的是哪一条申请？";
    list.textContent = "";
    for (const candidate of options) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "resume-pro__candidate";
      row.textContent = `${candidate.company} · ${candidate.title}`;
      row.addEventListener("click", async () => {
        box.hidden = true;
        const result = await chrome.runtime.sendMessage({
          type: "DESKTOP_CONFIRM_SUBMIT", applicationId: candidate.applicationId
        });
        setDesktopStatus(copy.describeConfirmResult(result ?? { status: "pending" }));
        refreshPendingList();
      });
      list.appendChild(row);
    }
    shadowRoot.querySelector("#resume-pro-bind-new").hidden = true;
    box.hidden = false;
  }

  // --- D08: archiving a finished fill ----------------------------------------------------
  //
  // After every fill the sidebar may offer to archive it. It never blocks the fill and never
  // throws into it, and a profile that has never paired a desktop is not asked at all: those
  // users keep nothing. What is offered is counts and timings; the field values stay here.

  async function offerFillRecord(raw, template) {
    const card = shadowRoot?.querySelector("#resume-pro-fill-record");
    if (!card) return;
    // Read the page before waiting on the worker: on a single-page site the user can move on
    // to the next posting meanwhile, and this fill must not be filed under that one. The
    // modules were warmed when the fill started; if they were not, and the page changed while
    // they loaded, there is no posting to offer this fill under.
    const pageUrl = location.href;
    const { extract, copy, fillrecords, snapshot } = await loadDesktopModules();
    if (location.href !== pageUrl) return;
    const job = extract.extractJobFields(document, pageUrl);
    const link = await chrome.runtime.sendMessage({ type: "DESKTOP_LINK_STATE" });
    if (!link?.everPaired) return;
    // The template the fill actually used, frozen now: editing the template before answering
    // must not change what the snapshot says was used (D08 decision 2).
    pendingFillTemplate = template ? structuredClone(template) : null;
    pendingFill = {
      ...raw,
      urlRedacted: job.sourceUrl,
      templateVersion: (await snapshot.templateVersionOf(template)) || "",
      pluginVersion: pluginVersion(),
      job: { company: job.company, title: job.title, sourceUrl: job.sourceUrl }
    };
    // The summary is built from exactly what would be sent, so the card cannot promise more.
    card.querySelector("#resume-pro-fill-record-summary").textContent =
      copy.describeFillOffer(fillrecords.buildFillPayload(pendingFill));
    const option = card.querySelector("#resume-pro-fill-record-snapshot");
    if (option) {
      option.checked = true;
      option.disabled = !pendingFillTemplate;
    }
    card.hidden = false;
  }

  function closeFillRecord() {
    const card = shadowRoot?.querySelector("#resume-pro-fill-record");
    if (card) card.hidden = true;
    pendingFill = null;
    pendingFillTemplate = null;
  }

  async function handleRecordFillClick() {
    const raw = pendingFill;
    if (!raw) return;
    const withSnapshot = shadowRoot?.querySelector("#resume-pro-fill-record-snapshot")?.checked;
    const snapshotTemplate = withSnapshot ? pendingFillTemplate : null;
    closeFillRecord();

    let candidates = null;
    if (raw.job?.company) {
      try {
        candidates = await chrome.runtime.sendMessage({ type: "DESKTOP_CANDIDATES_FOR", fields: raw.job });
      } catch {
        candidates = null;
      }
    }
    if (candidates?.status !== "ok") {
      // The desktop is not answering, or the page does not say which company this is. The
      // fill waits, and the application is picked from the pending list later.
      await recordFill(raw, null, snapshotTemplate);
      return;
    }

    const options = [...candidates.exact, ...candidates.sameCompany];
    showFillCandidates(options, {
      note: options.length
        ? "这次填写属于哪条申请？"
        : "桌面里还没有这家公司的申请。可以先「保存岗位到本地」，或者稍后在待同步里选择。",
      onPick: applicationId => recordFill(raw, applicationId, snapshotTemplate),
      onLater: () => recordFill(raw, null, snapshotTemplate)
    });
  }

  async function recordFill(raw, applicationId, snapshotTemplate) {
    const { copy } = await loadDesktopModules();
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "DESKTOP_RECORD_FILL", raw, applicationId, snapshotTemplate });
    } catch {
      result = { status: "rejected" };
    }
    setDesktopStatus(copy.describeFillRecordResult(result ?? { status: "rejected" }));
    revealDesktopStatus();
    refreshPendingList();
  }

  // The card sits under the fill result; the answer lands in the desktop section further
  // down. Bring it into view so the click does not look like it did nothing.
  function revealDesktopStatus() {
    shadowRoot?.querySelector("#resume-pro-desktop-status")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }

  // The same candidate box saving a job uses. There is no "new application" here: a fill
  // belongs to an application that exists, and nothing is ever bound on the user's behalf.
  function showFillCandidates(options, { note, onPick, onLater }) {
    const box = shadowRoot?.querySelector("#resume-pro-candidates");
    const list = shadowRoot?.querySelector("#resume-pro-candidate-list");
    if (!box || !list) return;
    shadowRoot.querySelector("#resume-pro-candidates-note").textContent = note;
    list.textContent = "";
    for (const candidate of options) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "resume-pro__candidate";
      row.textContent = `${candidate.company} · ${candidate.title}${candidate.stage ? `（${candidate.stage}）` : ""}`;
      row.addEventListener("click", () => {
        box.hidden = true;
        onPick(candidate.applicationId);
      });
      list.appendChild(row);
    }
    shadowRoot.querySelector("#resume-pro-bind-new").hidden = true;
    shadowRoot.querySelector("#resume-pro-bind-later").onclick = () => {
      box.hidden = true;
      onLater();
    };
    box.hidden = false;
    box.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }

  // What the desktop shows as an application's id. Checked before binding: a mistyped id would
  // otherwise be queued and then refused on every attempt.
  const APPLICATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // A waiting record, bound from the pending list.
  async function chooseFillApplication(record) {
    const { copy } = await loadDesktopModules();
    if (!record.job?.company) {
      const typed = prompt("这条留档要记到哪条申请？请粘贴桌面里的申请 ID：")?.trim();
      if (!typed) return;
      if (!APPLICATION_ID_PATTERN.test(typed)) {
        setDesktopStatus(copy.describeFillRecordResult({ status: "rejected", reason: "invalid_application_id" }));
        return;
      }
      await bindFillRecord(record.recordId, typed);
      return;
    }
    let candidates;
    try {
      candidates = await chrome.runtime.sendMessage({ type: "DESKTOP_CANDIDATES_FOR", fields: record.job });
    } catch {
      candidates = null;
    }
    if (candidates?.status !== "ok") {
      setDesktopStatus(copy.describeFillRecordResult({ status: "recorded", mode: "unavailable" }));
      return;
    }
    const options = [...candidates.exact, ...candidates.sameCompany];
    showFillCandidates(options, {
      note: options.length ? "这次填写属于哪条申请？" : "桌面里还没有这家公司的申请，请先保存岗位。",
      onPick: applicationId => bindFillRecord(record.recordId, applicationId),
      onLater: () => {}
    });
  }

  async function bindFillRecord(recordId, applicationId) {
    const { copy } = await loadDesktopModules();
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "DESKTOP_BIND_FILL", recordId, applicationId });
    } catch {
      result = { status: "pending" };
    }
    setDesktopStatus(copy.describeFillRecordResult(result ?? { status: "pending" }));
    revealDesktopStatus();
    refreshPendingList();
  }

  function closeSaveForm() {
    const form = shadowRoot?.querySelector("#resume-pro-save-form");
    if (form) form.hidden = true;
    pendingFields = null;
  }

  async function submitSaveForm({ force }) {
    const form = shadowRoot?.querySelector("#resume-pro-save-form");
    if (!form) return;

    const fields = {
      company: form.querySelector("#resume-pro-save-company").value.trim(),
      title: form.querySelector("#resume-pro-save-title").value.trim(),
      location: form.querySelector("#resume-pro-save-location").value.trim(),
      // The URL is whatever redaction produced when the form opened. It is not editable and
      // is never re-read from the address bar here, so no un-redacted URL can reach storage.
      sourceUrl: pendingFields?.sourceUrl || "",
      dedupeUrl: pendingFields?.dedupeUrl || ""
    };

    const { copy } = await loadDesktopModules();
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "DESKTOP_SAVE_JOB", fields, force });
    } catch (error) {
      result = { status: "error" };
    }

    setDesktopStatus(copy.describeSaveResult(result ?? { status: "error" }));
    if (result?.status === "queued") {
      closeSaveForm();
      if (result.mode === "ready") {
        await offerCandidates(result.intent.intentId);
      }
    }
    refreshPendingList();
  }

  // Two layers, per §7. The exact layer is "this may be the same posting again"; the
  // same-company layer is a hint and nothing more. Neither ever binds on its own — the
  // default is always a new application.
  async function offerCandidates(intentId) {
    const box = shadowRoot?.querySelector("#resume-pro-candidates");
    const list = shadowRoot?.querySelector("#resume-pro-candidate-list");
    if (!box || !list) return;

    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "DESKTOP_CANDIDATES", intentId });
    } catch {
      return;
    }
    if (result?.status !== "ok") return;

    list.textContent = "";
    const note = shadowRoot.querySelector("#resume-pro-candidates-note");
    const total = result.exact.length + result.sameCompany.length;
    note.textContent = total
      ? "桌面里有相关的申请。要绑定到已有的哪一条，还是新建？默认新建。"
      : "桌面里没有相关的申请，确认后会新建一条。";

    appendCandidateGroup(list, "可能是同一岗位的重复投递", result.exact, intentId);
    appendCandidateGroup(list, "同公司的其他岗位（仅供参考）", result.sameCompany, intentId);

    box.hidden = false;
    const bindNew = shadowRoot.querySelector("#resume-pro-bind-new");
    bindNew.hidden = false;
    bindNew.onclick = () => bindIntent(intentId, null);
    shadowRoot.querySelector("#resume-pro-bind-later").onclick = () => {
      // §5.2.4: cancelling the picker keeps the intent pending. Nothing is bound and nothing
      // is discarded.
      box.hidden = true;
    };
  }

  function appendCandidateGroup(list, heading, candidates, intentId) {
    if (!candidates.length) return;
    const title = document.createElement("p");
    title.className = "resume-pro__save-note";
    title.textContent = heading;
    list.appendChild(title);

    for (const candidate of candidates) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "resume-pro__candidate";
      row.textContent = `${candidate.company} · ${candidate.title}${candidate.stage ? `（${candidate.stage}）` : ""}`;
      row.addEventListener("click", () => bindIntent(intentId, candidate.applicationId));
      list.appendChild(row);
    }
  }

  async function bindIntent(intentId, applicationId) {
    const { copy } = await loadDesktopModules();
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "DESKTOP_BIND", intentId, applicationId });
    } catch {
      result = { status: "pending" };
    }

    const box = shadowRoot?.querySelector("#resume-pro-candidates");
    if (box) box.hidden = true;
    setDesktopStatus(copy.describeBindResult(result ?? { status: "pending" }));
    refreshPendingList();
  }

  function setDesktopStatus(copy) {
    const box = shadowRoot?.querySelector("#resume-pro-desktop-status");
    if (!box) return;
    box.textContent = "";
    box.className = "resume-pro__desktop-status";
    if (!copy) return;

    box.classList.add(`is-${copy.tone}`);
    const line = document.createElement("p");
    line.textContent = copy.text;
    box.appendChild(line);

    if (copy.extensionId) {
      const id = document.createElement("code");
      id.className = "resume-pro__extension-id";
      id.textContent = copy.extensionId;
      box.appendChild(id);
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "resume-pro__manager-button";
      copyButton.textContent = "复制扩展 ID";
      copyButton.addEventListener("click", () => copyText(copy.extensionId));
      box.appendChild(copyButton);
    }

    if (copy.hint) {
      const hint = document.createElement("p");
      hint.className = "resume-pro__save-note";
      hint.textContent = copy.hint;
      box.appendChild(hint);
    }

    if (copy.offerForce) {
      const again = document.createElement("button");
      again.type = "button";
      again.className = "resume-pro__manager-button";
      again.textContent = "再存一次";
      again.addEventListener("click", () => submitSaveForm({ force: true }));
      box.appendChild(again);
    }
  }

  async function refreshPendingList() {
    const details = shadowRoot?.querySelector("#resume-pro-pending");
    const list = shadowRoot?.querySelector("#resume-pro-pending-list");
    if (!details || !list) return;

    let intents = [];
    let outbox = [];
    let fillRecords = [];
    let expired = new Set();
    let copy;
    try {
      const reply = await chrome.runtime.sendMessage({ type: "DESKTOP_LIST_QUEUE" });
      intents = reply?.intents || [];
      outbox = reply?.outbox || [];
      fillRecords = reply?.fillRecords || [];
      expired = new Set(reply?.expiredSnapshots || []);
      ({ copy } = await loadDesktopModules());
    } catch {
      return;
    }

    const total = intents.length + outbox.length + fillRecords.length;
    details.hidden = total === 0;
    shadowRoot.querySelector("#resume-pro-pending-count").textContent = String(total);
    list.textContent = "";

    for (const intent of intents) {
      const row = pendingRow(
        `${intent.fields.company} · ${intent.fields.title}`,
        intent.fields.sourceUrl,
        intent.status === "pending_bind" ? "待绑定申请" : "待同步（尚未绑定申请）"
      );
      if (intent.status === "pending_bind") {
        row.appendChild(rowButton("选择绑定", () => offerCandidates(intent.intentId)));
      }
      row.appendChild(rowButton("删除", async () => {
        await chrome.runtime.sendMessage({ type: "DESKTOP_REMOVE_INTENT", intentId: intent.intentId });
        refreshPendingList();
      }));
      list.appendChild(row);
    }

    for (const record of fillRecords) {
      const row = pendingRow(
        `填写留档 · ${record.fill?.templateName || ""}`,
        [record.job?.company, record.job?.title].filter(Boolean).join(" · "),
        "待同步（尚未选择申请）"
      );
      if (record.snapshot && expired.has(record.snapshot.snapshotId)) {
        appendNote(row, "附带的简历快照已暂存超过 30 天，要继续还是丢弃？");
        row.appendChild(rowButton("丢弃快照", () => dropSnapshot(record.snapshot.snapshotId)));
      }
      row.appendChild(rowButton("选择申请", () => chooseFillApplication(record)));
      row.appendChild(rowButton("删除", async () => {
        await chrome.runtime.sendMessage({ type: "DESKTOP_REMOVE_FILL", recordId: record.recordId });
        refreshPendingList();
      }));
      list.appendChild(row);
    }

    for (const entry of outbox.filter(item => item.messageType === "snapshot.upload")) {
      const state = copy.describeSnapshotUpload(entry, { expired: expired.has(entry.snapshotId) });
      const row = pendingRow(`简历快照 · ${entry.payload?.templateName || ""}`, "", state.text);
      if (entry.status === "paused" || entry.status === "needs_user") {
        // After a restore the only ways out are the user's: upload the kept original again
        // under a new identity, or let it go. Never a plain retry of the old chunks.
        appendNote(row, copy.describeSnapshotReconcile(entry.reconcileStatus).text);
        row.appendChild(rowButton("重新上传到当前档案", () => resolvePaused(entry, "resave")));
        row.appendChild(rowButton("丢弃快照", () => resolvePaused(entry, "discard")));
        list.appendChild(row);
        continue;
      }
      if (state.retry) {
        row.appendChild(rowButton("立即重试", async () => {
          await chrome.runtime.sendMessage({ type: "DESKTOP_RETRY", messageId: entry.messageId });
          refreshPendingList();
        }));
      }
      row.appendChild(rowButton(entry.status === "bytes_lost" ? "移除" : "丢弃快照", () => dropSnapshot(entry.snapshotId)));
      list.appendChild(row);
    }

    for (const entry of outbox.filter(item => item.messageType !== "snapshot.upload")) {
      const row = pendingRow(queueLabel(entry), entry.payload?.sourceUrl, describeOutboxState(entry));
      if (entry.status === "needs_user" || entry.status === "paused") {
        appendReconcileChoices(row, entry);
        list.appendChild(row);
        continue;
      }
      row.appendChild(rowButton("立即重试", async () => {
        const { copy } = await loadDesktopModules();
        const result = await chrome.runtime.sendMessage({ type: "DESKTOP_RETRY", messageId: entry.messageId });
        setDesktopStatus(describeQueueResult(copy, entry, result ?? { status: "pending" }));
        refreshPendingList();
      }));
      row.appendChild(rowButton("取消", async () => {
        await chrome.runtime.sendMessage({ type: "DESKTOP_CANCEL", messageId: entry.messageId });
        refreshPendingList();
      }));
      list.appendChild(row);
    }
  }

  function appendNote(row, text) {
    const note = document.createElement("em");
    note.textContent = text;
    row.appendChild(note);
  }

  // The fill record stays; only the snapshot copy and its upload go.
  async function dropSnapshot(snapshotId) {
    await chrome.runtime.sendMessage({ type: "DESKTOP_DROP_SNAPSHOT", snapshotId });
    refreshPendingList();
  }

  // Each kind of queued message has its own wording: a retried fill must not report that a
  // job was saved, nor a refused one ask the user to check a company name.
  function describeQueueResult(copy, entry, result) {
    if (entry.messageType === "fill.submit") return copy.describeFillRecordResult(result);
    if (entry.messageType === "snapshot.upload") return copy.describeSnapshotResolveResult(result);
    if (entry.messageType === "submit.confirm") return copy.describeConfirmResult(result);
    return copy.describeBindResult(result);
  }

  function queueLabel(entry) {
    if (entry.messageType === "fill.submit") return `填写留档 · ${entry.payload?.templateName || ""}`;
    if (entry.messageType === "submit.confirm") return "确认已投递";
    return `${entry.payload?.company || ""} · ${entry.payload?.title || ""}`;
  }

  function pendingRow(label, title, state) {
    const row = document.createElement("div");
    row.className = "resume-pro__pending-row";

    const name = document.createElement("span");
    name.textContent = label;
    name.title = title || "";
    row.appendChild(name);

    const status = document.createElement("em");
    status.textContent = state;
    row.appendChild(status);
    return row;
  }

  function rowButton(text, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "resume-pro__manager-button";
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  // After a restore the queued envelope carries an epoch the desktop has replaced. There is
  // no "retry" here on purpose: the only ways out are the three the user chooses.
  function appendReconcileChoices(row, entry) {
    loadDesktopModules().then(({ copy }) => {
      const explain = copy.describeReconcileStatus(entry.reconcileStatus);
      const note = document.createElement("em");
      note.textContent = explain.text;
      row.appendChild(note);
    });

    row.appendChild(rowButton("关联到已有申请", async () => {
      const applicationId = prompt("要关联到哪条申请？请粘贴桌面里的申请 ID：");
      if (!applicationId) return;
      await resolvePaused(entry, "associate", applicationId.trim());
    }));
    row.appendChild(rowButton("另存为新的", () => resolvePaused(entry, "resave")));
    row.appendChild(rowButton("丢弃", () => resolvePaused(entry, "discard")));
  }

  async function resolvePaused(entry, choice, applicationId) {
    const { copy } = await loadDesktopModules();
    const result = await chrome.runtime.sendMessage({
      type: "DESKTOP_RESOLVE", messageId: entry.messageId, choice, applicationId
    });
    if (choice !== "discard") {
      // A resaved snapshot is queued, not yet on the desktop: described as pending.
      const shown = result?.status === "queued" ? { status: "pending" } : (result ?? { status: "pending" });
      setDesktopStatus(describeQueueResult(copy, entry, shown));
    }
    refreshPendingList();
  }

  // The reason is the plugin's own classification, not the protocol text: the wording table
  // in link/copy.mjs is the only place that turns a code into a sentence.
  function describeOutboxState(entry) {
    if (entry.status === "paused") return "桌面换过档案库，已暂停";
    if (entry.status === "needs_user") return "桌面换过档案库，等你决定";
    if (entry.status === "failed") return `已停下，需要处理（${describeFailure(entry.lastError)}）`;
    if (entry.status === "stalled") return `重试多次仍未成功，等你决定（${describeFailure(entry.lastError)}）`;
    const next = entry.nextAttemptAt ? `，下次重试 ${formatClock(entry.nextAttemptAt)}` : "";
    return `待同步（已尝试 ${entry.attempts || 0} 次${next}）`;
  }

  function describeFailure(code) {
    if (code === "unavailable") return "桌面暂时不可用";
    if (code === "invalid_payload") return "桌面看不懂这条内容";
    if (code === "restore_epoch_mismatch") return "桌面换过档案库";
    if (code === "previously_purged") return "已在桌面永久删除";
    if (code === "conflict") return "与桌面已有记录冲突";
    return "原因未知";
  }

  function formatClock(iso) {
    const at = new Date(iso);
    return Number.isNaN(at.getTime())
      ? "稍后"
      : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  if (self.__RESUME_PRO_TEST__) {
    self.ResumeProHighlightTest = {
      applySidebarUiState,
      bindStorageSync,
      constrainSidebarToViewport,
      persistSidebarUiState,
      readSidebarUiState,
      stopDrag,
      handleRepeatFillClick,
      formatFillDiagnostics,
      getHighlightTargets,
      handleAiFillClick,
      handleCollectFillClick,
      handleChipAction,
      handleFieldChipClick,
      highlightFilledField,
      injectFieldHighlightStyles,
      isInViewport,
      applyChipValue,
      composeChipText,
      syncChipSelectionState,
      // 扫描链路：标签解析、控件识别、快照采集。挂在钩子上是为了能用真代码验证，
      // 不必把逻辑复制一份到测试里（复制出来的那份很快就会和真的走偏）。
      mappingMatches,
      refreshFieldEntry,
      verifyWrittenValues,
      verifyFilledValue,
      reviewFieldName,
      setElementValue,
      fillCombobox,
      fillDateWithAgent,
      genericDateAgent,
      validDateOrder,
      rangeMatchReason,
      scanFillableFields,
      prefetchComboOptions,
      comboAgent,
      collectComboboxRoots,
      visibleComboOptions,
      comboSelectors: () => ({ root: COMBO_ROOT_SELECTOR, trigger: COMBO_TRIGGER_SELECTOR, option: COMBO_OPTION_SELECTOR, display: COMBO_DISPLAY_SELECTOR }),
      getFieldLabel,
      formItemLabel,
      pickerRangeLabel,
      classHint,
      isFormatPlaceholder,
      markUnreliableLabels,
      collectControlHints,
      buildCaptureTargets,
      scanCaptureTargets,
      formatFieldTrace,
      readBackValue,
      readFilledFields,
      hasExistingValue,
      captureFormStructure,
      setCurrentStore(store) {
        state.currentStore = store;
      },
      setLastFocusedField(field) {
        state.lastFocusedField = field;
      },
      setDragging(dragging) {
        state.dragging = Boolean(dragging);
      },
      setSidebarUiState(uiState) {
        state.sidebarUiState = self.ResumeProSidebarState.normalize(uiState);
      },
      getSidebarUiState() {
        return self.ResumeProSidebarState.normalize(state.sidebarUiState);
      },
      setShadowRoot(root) {
        shadowRoot = root;
      }
    };
  }
})();
