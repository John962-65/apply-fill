# Week 5 验收报告

任务编号：W5-01 ~ W5-12（对应 design.md 第十四章 Week 5 任务表）
任务名称：终态验证、人工接管与真实 ATS 回归
日期：2026-10-16
依据：`design.md` Week 5 任务表、完成标准与阶段门禁 G5

## 一、实现内容

### 交付物（按任务）

| 任务 | 交付物 | 状态 |
|---|---|---|
| W5-01 | DirtyChecker 终态复检：`observedValueMatches`（严格，仅 COMPONENT_STATE/FORM_VALUE）与 `observedValuePreserved`（宽松，任意非空来源）；`runRecovery` 原因后缀规则（`recovery:<reason>`，既有 reason 不追加）；终态重扫与 `dataStateKind` 交叉核验 | 完成 |
| W5-02 | RecoveryPlanner 有界恢复：决策顺序 NO_EXPECTED_VALUE → ELEMENT_LOST → validationError → COMMIT_UNKNOWN（前置）→ valueMatches→REVERIFY → CIRCUIT_BROKEN → NOT_REFILLABLE → 预算 → REFILL；`DEFAULT_MAX_REFILLS=8`；预算耗尽 → NEEDS_MANUAL `RETRIES_EXHAUSTED`；引擎不产生 CIRCUIT_BROKEN（契约级） | 完成 |
| W5-03 | QuickFillPill 悬浮人工接管：状态机 + 全部 testid（`pill-*`）；跳过 → `USER_SKIPPED`；标记核对 → `noteUserEdit` + `USER_CONFIRMED_MANUAL`；换来源列表文案 `` `${label}：${preview}` ``；主观题「结合 JD 生成」→ 预览 → 应用（走引擎/CommitPredicate，VERIFIED 后移除该字段 issue） | 完成 |
| W5-04 | SidePanel 完整报告：13.4 全部 testid（`final-report`/`report-*`/`recovery-line`/`new-required-line`/`validation-line`/`retry-field-<key>`/`final-submit`「最终提交：未执行」）；GET_STATE 不泄漏 COMMAND_RESULT | 完成 |
| W5-05 | UserInteractionObserver 覆盖保护：用户输入后字段锁定为 USER_OVERRIDDEN 且写入 `userCorrections.v1`（cap 200，不存字段值）；用户删除必填 → 新增 NEW_REQUIRED 记录 | 完成 |
| W5-06 | MappingMemory：`applyfill.mappingMemory.v1`，主键 `host::sectionType::normalizeLabel::controlKind`，500 条 LRU；`recordVerified` 不降级 user 来源；planner 顺序 cache → memory → rule → llm；`MappingIssue.fieldKey` 盖章 | 完成 |
| W5-07 | JDSniffer + `applyfill.jdContext.v1`（session，TTL 6h）；`background.ts` 设置 `chrome.storage.session.setAccessLevel(TRUSTED_AND_UNTRUSTED_CONTEXTS)` | 完成 |
| W5-08 | EssayGenerator（确定性草稿，综合 JD 关键词与项目事实）；pill essay 仅对 `essayCapable && controlKind==='textarea'` 展示（projects[0] 或 introShort 存在） | 完成 |
| W5-09 | 25 类核心控件回归：`docs/week5-regression-matrix.md`（T01~T25 全表）；新增 react-virtual 靶场（虚拟滚动、预挂载浮层、异步加载弹层）与 `virtual.spec.ts`；T17 停滞有界断言 `datepicker-stagnation.spec.ts`（`?deadnav=1` 死导航模式）；`basic.birthDate` 规则 + react-native 原生日期用例 | 完成 |
| W5-10 | PATCH-01/02/04 专项回归：`docs/week5-patch-regression.md`（RA01-10 / WS01-10 / WL01-15 映射）；新增 RA02、重复释放幂等、旧事务 assertActive 拒绝单测；修复 DateAgent `findPresentControl` 误点包裹容器缺陷（打分：可激活控件 +1000 与深度，附单测）；`daterange-present.spec.ts`（`至今` 触发位提交） | 完成 |
| W5-11 | 真实 ATS 测试：`docs/ats-test-plan.md`（计划、执行状态、原因、等价回归映射、取得权限后的执行指引）；**未执行（BLOCKED，外部依赖）**，如实记录 | PARTIAL |
| W5-12 | 隐私审计与打包：`tests/unit/privacyBoundary.test.ts`（源码静态扫描零网络 API）、`e2e/privacy.spec.ts`（运行期无非 localhost 请求）、`docs/privacy-audit.md`；`pnpm --filter @applyfill/extension zip` 产物 | 完成 |

### 关键算法与接口

- 人工接管闭环：pill issue 行仅拾取非失败字段的 UNMAPPED/NO_DATA/NO_OPTION，`requiresSource` 行保留「换来源」；essay 流与「换来源 → 应用」共用引擎单字段执行路径（`applyEssay` 尊重 CommitPredicate，成功才刷新 summary 并移除 issue）。
- 终态一致性：DirtyChecker 双函数分离「值相等」与「值保留」，runRecovery 原因沿用既有前缀规则，避免组合原因重复拼接。
- 记忆安全：MappingMemory 只存 `label→targetPath` 映射与来源等级，不存字段值；用户修正仅在用户真实编辑后写入。
- SPA 联动（18.3 场景）：react-final 五步表单以 300ms 防抖自动推进；引擎按迭代进行步进指纹检测；教育经历 1→2、项目经历 1→3 扩容依赖 `data-applyfill-add` 显式钩子与区块 h2 头部；主观题 `自荐理由` 为 UNMAPPED → pill 生成 → 应用后才推进到第 5 步，保证人工接管发生在对应步骤可见期间。
- 步骤文本探针：`final-step` 输出「当前步骤：N」供终态与验收断言。

### 接口变化

- 内容侧 `QuickFillPillActions`（`onGenerateEssay`/应用草稿/换来源/跳过/标记核对/重试/定位等）与 SidePanel 报告数据源 `RunSummary`（沿用 W4 的 frames/stepTransitions 结构并渲染 13.4 全量字段）；人工接管动作全部在内容脚本内走引擎单字段执行路径（不新增跨进程协议）。
- 存储：`mappingMemory.v1`、`userCorrections.v1`、`jdContext.v1`、`applyfill.run.*`（session）。

## 二、测试结果

### 通过测试

- 单元测试：39 个文件 / 304 个用例全部通过（Week 5 新增 `dirtyChecker`、`recoveryPlanner`、`quickFillPill`、`sidepanel` 报告、`userInteractionObserver`、`mappingMemory`、`jdSniffer`、`essayGenerator`、`reanchorManager`（+RA02）、`guardRegistry`（+2）、`dateAgent`（+至今点击优先级）、`privacyBoundary` 等用例）。
- E2E：39 个用例全部通过（含 W5 新增 `virtual`（3）、`datepicker-stagnation`、`daterange-present`、`pill`、`sidepanel`、`memory`、`jd`、`user-protection`、`privacy`、`final`（18.3 最终验收场景）；W1~W4 既有 spec 无回归）。
- 门禁：`typecheck` ✓ / `lint` ✓ / `build`（含 zip）✓ / `pnpm -C apps/extension test` ✓ / `pnpm test:e2e` ✓（39 passed，1.8m）。

### 失败测试

- 无。

### 未运行测试

- 真实 ATS 15 个目标入口（W5-11，BLOCKED，见 `docs/ats-test-plan.md` 第二节原因表）。
- 跨域 iframe 内自动填写（浏览器隔离限制，如实报告 UNREACHABLE）。

## 三、实际验证范围

- 本地单元测试：见第二节清单，覆盖终态复检、恢复预算、记忆等级、essay 确定性、隐私边界静态扫描等。
- React/Vue 动态靶场（真实浏览器 + 加载构建产物扩展）：
  - 25 类核心控件矩阵（`docs/week5-regression-matrix.md`，T01~T25 全绿）；
  - `react-virtual`：30 项虚拟滚动列表目标 index 25、预挂载 display 切换浮层、250ms 异步加载弹层；
  - `?deadnav=1` 停滞场景：NEEDS_MANUAL 有界终止、`data-committed` 未被写入、点击计数有界（<300）；
  - `至今` 日期区间提交：`'2020-09-01 ~ 至今'` 并 VERIFIED；
  - `react-final`（18.3 完整场景）：五步 SPA、步骤切换 ≥3 次且最终停留第 5 步、2 条教育经历（毕业年/月分别提交）、3 条项目经历、`是否应届毕业生` 选择、`期望薪资（千元）` 填写、`自荐理由` 经 pill 生成并应用后推进、附件上传 `data-file-accepted=true`、提交按钮点击计数 0。
- 隐私与打包：
  - 源码零网络 API（静态扫描）+ e2e 运行期无非 localhost 请求；
  - `apps/extension/.output/applyfillextension-0.1.0-chrome.zip`：149,657 字节，SHA-256 `fc86a39b0914a3631b283b1f03f3e6e03bbbdf7f7150c0fe8feca7322dca99c5`（与 W5-12 打包一致，源码无变更）。

## 四、已知问题

- 真实 ATS 整页完成率（KPI ≥90%）无实机证据；W5-11 处于 BLOCKED，Beta 声明必须携带此未完成项。
- SPA 步骤自动推进依赖页面侧防抖（18.3 靶场为 300ms）与引擎 400ms `waitForChange` 窗口配合；非本仓库约定的第三方页面若在迭代中切换步骤，可能出现「记录了步进但不再补迭代」的保守行为（引擎按设计不重放）。
- 教育/项目扩容依赖可识别的区块标题（h2/legend）与 `data-applyfill-add` 或文本匹配的添加按钮；无标题无按钮的纯样式区块报告 `NO_ADD_CONTROL` 转人工。
- 跨域 iframe、自定义拖拽上传（无 file input）、CDP 注入策略（MVP 外）等限制与 W4 报告一致。
- 虚拟列表仅支持结构可识别的滚动容器（`scrollHeight-clientHeight>8`）；异步弹层需具备可滚动加载占位，否则按「无进展」终止并转人工。

## 五、验收结论

**PARTIAL**

- G1~G4：维持 PASS。
- G5「完整产品可用性」7 项中 6 项通过：Workbench 简历管理 ✓ / SidePanel 任务控制 ✓ / 失败字段人工接管 ✓ / 缓存安全复用 ✓ / 核心自动化回归通过（单测 304 + e2e 39 + 25 类矩阵 + PATCH 专项）✓ / 可生成安装包（zip 149,657B，SHA-256 已记录）✓；**「真实 ATS 测试完成并形成报告」未达成**（外部依赖 BLOCKED，仅形成 `docs/ats-test-plan.md` 台账与等价回归映射）。
- 按 design.md「若 G1~G5 尚未全部通过，应如实标记 Beta 状态和未完成项」：当前如实标记 **Beta（未完成项：W5-11 真实 ATS 实机验证）**；取得任一目标站点合法测试入口后，按 `docs/ats-test-plan.md` 第四节执行并更新本报告。
