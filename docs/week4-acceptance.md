# Week 4 验收报告

任务编号：W4-01 ~ W4-11（对应 design.md 第十四章 Week 4 任务表）
任务名称：日期层、跨 Frame 执行、SPA 步骤感知与会话恢复
日期：2026-10-16
依据：`design.md` Week 4 任务表、完成标准与阶段门禁 G4

## 一、实现内容

### 修改/新增文件（按交付物）

| 任务 | 交付物 | 状态 |
|---|---|---|
| W4-01 | `actuator/DateAgent.ts`（日期专用状态机：打开 → 视图识别 → 定位 → 点击 → 提交验证；`DATE_PICKER_FIELD_BUDGET` 60 动作/20s/无进展 2/重试 1）；`shared/utils/date.ts`（ISO 解析、年月日原子、月末对齐、tolerant 比较） | 完成 |
| W4-02 | `actuator/DateViewClassifier.ts`（日/月/年/十年视图分类；`panelSignature` 进展签名） | 完成 |
| W4-03 | 日期翻页有界导航（上/下个月、上/下十年按视图选择；每次点击后 `locate()` 重定位；`maxNoProgress` 熔断） | 完成 |
| W4-04 | DateRange 适配：`resolveResumePath` 合成 `'2020-09 ~ 2022-06'`（含 `至今`）；双面板分别翻页；`CommitPredicate.dateAwareMatches` / `dateRangeTolerantMatches`（任一侧为 range 时必须双端按 atom 精度容忍匹配） | 完成 |
| W4-05 | `background/FrameRegistry.ts`（注册/列表/清理 + documentId 不一致防串）；`FRAME_HELLO` 协议；`content.ts` `allFrames: true`；`webNavigation` 权限 | 完成 |
| W4-06 | `background/TabCoordinator.ts`（webNavigation 发现 + 注册表回退；逐帧串行；聚合 counts/fields/issues/instances/waves/dependencies/cycles/dirty/stepTransitions；不可达/忙/超时如实报告） | 完成 |
| W4-07 | 跨帧执行许可：`RUN_COORDINATED` 经后台协调，帧内互斥 `RUN_IN_PROGRESS`；`RUN_CANCEL` 广播全部已注册帧；`tabs.onRemoved` 清理 | 完成 |
| W4-08 | `runtime/StepObserver.ts`（hash/pushState/replaceState/popstate/hashchange + MutationObserver；指纹 = hash|pathname|控件集|标题数；`waitForChange` 400ms 轮询）；executeRun 步骤循环（executedKeys 去重、`stepTransitions` 记录、`MAX_STEP_TRANSITIONS=5`） | 完成 |
| W4-09 | `background/SessionStore.ts` 恢复策略（`chrome.storage.session` 持久化；SW 重启后 RUNNING/PAUSED → `INTERRUPTED`，写入前二次复查，不重放旧动作）；`RunStatus` 增 `INTERRUPTED` | 完成 |
| W4-10 | 取消链完善：`TabCoordinator.cancel` 广播 + `RUN_CANCEL` 后台消息；内容侧 AbortController 贯穿引擎/DateAgent；中止后不再产生新点击与写入 | 完成 |
| W4-11 | `actuator/FileUploadAgent.ts`（DataTransfer 注入 → input/change → 文件列表核验 → 网站接收状态轮询；`SITE_CONFIRMED` / `INJECTED_UNCONFIRMED`（转人工）/ `REJECTED`）；`resume/storage/attachmentStore.ts`（IndexedDB）；Workbench 附件区 + `UPLOAD_ATTACHMENT` 链路 | 完成 |

### 关键算法与接口

- 日期层：先做 `hasDateElementHints` 判定（placeholder/aria/class 关键词、显示值与 committed 的日期形态、**range 串解析**），命中才进入 DateAgent；原生 `input[type=date]` 走 setter + change；非日期控件返回 `NOT_DATE` 回退既有 combobox/cascader 路径（保证 W3 行为无回归）。
- 长操作租约：`FieldExecutionEngine.LONG_ACTION_KINDS = {combobox, date}` 在 acquire 时携带 `ttlMs = MAX_ACTION_LEASE_MS (10000)`；修复 range 填写约 39 动作耗时超默认 3000ms 租约导致的 LEASE_EXPIRED 重试。
- 跨帧聚合：`TabCoordinator` 逐帧串行（跨帧互斥）；status 规则 — 无帧或无可执行帧 FAILED、任一帧 CANCELLED 则 CANCELLED、否则 COMPLETED；帧响应失败区分 BUSY/FAILED/UNREACHABLE；`about:srcdoc` 等发送失败如实记 UNREACHABLE。
- SPA：迭代制执行 — 每次迭代后比较迭代前后指纹（记录 in-iteration 切换，吸收引擎自身 DOM 变化，如 repeater 扩容），`waitForChange(400ms)` 检测迭代结束后的再次切换并触发下一轮；`executedKeys` 保证不重复执行；实例报告按 `sectionType|instanceId` 去重、映射问题按内容去重；dirty 检查使用**最终协调后 plan**（修复跨步骤陈旧字段误绑定/误写）。
- 会话恢复：SW 启动时扫 `applyfill.run.*`，仅将仍为 RUNNING/PAUSED 的会话标记 INTERRUPTED（写入前再次读取复查，避免与新启动 Run 竞争）；主帧运行中的会话在 RUN_FINISHED 事件到达后自愈为终态。
- 附件上传：文件字节存 IndexedDB（`applyfill-files`），内容脚本经 `GET_ATTACHMENT` 取字节构造 `File` → `DataTransfer` 注入 → 轮询核验 `files.length` 与网站自身确认（作用域内出现文件名文本）；网站清空列表 → REJECTED；超时未确认 → INJECTED_UNCONFIRMED（人工兜底）。

### 接口变化

- `RunSummary` 增 `frames`（各帧状态/计数/runId/错误）、`stepTransitions`（步骤切换记录：index/fingerprint/fields）。
- `RunStatus` 增 `INTERRUPTED`；`SessionRunState.error` 承载恢复原因。
- 协议：`TabMessage` 增 `UPLOAD_ATTACHMENT`；`BackgroundMessage` 增 `RUN_CANCEL`、`GET_ATTACHMENT`、`UPLOAD_ATTACHMENT`；`FrameRunResponse` / `AttachmentInfo` / `UploadAttachmentResponse`。
- 后台目标页解析：新增 `webPageTabId`（仅信任 http(s) 来源的 sender.tab，避免把 Workbench 自身 tab 误认为页面）；`findTargetTab` 在活动窗口无本地页时回退查询 localhost 标签页。

## 二、测试结果

### 通过测试

- 单元测试：31 个文件 / 245 个用例全部通过（W4 新增 `dateAgent.test.ts`、`tabCoordinator.test.ts`、`stepObserver.test.ts`、`sessionStore.test.ts`、`fileUploadAgent.test.ts` 及 CommitPredicate range 容忍等用例）。
- E2E：24 个 spec 全部通过（W4 新增 `datepicker`、`daterange`、`frames`、`spa`、`upload`（2 例）、`cancel` 日期翻页取消；W2/W3 全部既有 spec 无回归）。
- 门禁：`typecheck` ✓ / `lint` ✓ / `build` ✓ / `test` ✓ / `test:e2e` ✓。

### 失败测试

- 无。

### 未运行测试

- 真实 ATS 日期组件（如 Workday 日期字段）与真实附件上传服务未接入，按计划为 W5+ 范围。
- CDP 注入策略未实现（design.md 13.1 明确不纳入 MVP）。

## 三、实际验证范围

- 本地单元测试：DateAgent 状态机与预算、range 提示幂等性、TabCoordinator 聚合/取消广播/探测回退、StepObserver 指纹与等待、SessionStore 恢复、FileUploadAgent 全分支。
- React 动态靶场（真实浏览器 + 加载构建产物扩展）：
  - `react-datepicker`：跨年代翻页选择 2026-03-15，`data-committed` 回写，点击计数 ≥4；
  - `react-daterange`：双面板分别翻页，提交 `'2020-09-01 ~ 2022-06-30'`，range 容忍匹配通过；
  - `react-frames`：主帧 + 同源子帧串行填写（跨域/child 帧 COMPLETED），`about:srcdoc` 帧如实 UNREACHABLE；
  - `react-spa`：填写姓名后页面 hash 推进，自动重新发现并填写邮箱，`stepTransitions` 记录 1 次切换；
  - `react-upload`（常规组件）：注入 PDF 后网站显示文件名 → SITE_CONFIRMED；`react-upload-strict`（仅信任真实用户操作）：REJECTED 转人工；
  - `cancel`：日期翻页中取消 → 取消后点击计数不再增长；页面填写中取消 → 不再产生新写入。
- 回归：W2/W3 全部 React/Vue 靶场（受控组件、repeater、reanchor、ambiguity、waves、北森月份）通过。

## 四、已知问题

- DateAgent 每次点击后依赖 `locate()` 重定位，重渲染极频繁的组件可能触发 `maxNoProgress` 熔断并使用原生 setter 兜底；跨月翻页采用逐月导航，跨度大的年份区间耗时接近预算上限。
- SPA 步骤切换依赖指纹（hash/控件集/标题数），不改变这些维度且不触发 MutationObserver 的极端路由（如纯文本步骤签）可能不被识别，仍有 reconcile 增量兜底。
- 跨帧执行仅支持同源子帧与 srcdoc；跨域帧将如实报告 UNREACHABLE（受浏览器隔离限制）。
- 附件上传对自定义拖拽组件（无 input[type=file]）报告 NO_FILE_INPUT 转人工；`INJECTED_UNCONFIRMED` 不视为成功。
- Session 恢复标记 INTERRUPTED 后不自动续跑（无重放），需要用户重新触发（符合"优先重新验证而不是重放动作"）。

## 五、验收结论

PASS（G4：日期层、跨帧、SPA、会话恢复、取消链与附件上传全部通过）
