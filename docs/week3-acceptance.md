# Week 3 验收报告

任务编号：W3-01 ~ W3-12（对应 design.md 第十四章 Week 3 任务表）
任务名称：三波次调度与复杂 Select 微代理
日期：2026-10-15
依据：`design.md` Week 3 任务表、完成标准与阶段门禁 G3

## 一、实现内容

### 修改/新增文件（按交付物）

| 任务 | 交付物 | 状态 |
|---|---|---|
| W3-01 | `scheduler/WaveClassifier.ts`（波次分类：结构关键词 + 控件类型；`WaveClassifier` 类） | 完成 |
| W3-02 | `scheduler/WaveScheduler.ts`（`runWave`：快照 → 执行 → 安静等待 → 差分 → 依赖记录；`WaveExecutor` 注入） | 完成 |
| W3-03 | `scheduler/WaveBarrier.ts`（防抖安静窗口 200ms / 上限 2000ms；`snapshotFields` / `waitForQuiet` / `diff`；忽略 `[data-applyfill-ui]`） | 完成 |
| W3-04 | `scheduler/RuntimeDependencyRegistry.ts`（依赖记录、去重、BFS 环检测、上限 200） | 完成 |
| W3-05 | `scheduler/ExecutionMutex.ts`（FIFO 全局浮层互斥、`MUTEX_TIMEOUT` / `MUTEX_ABORTED`） | 完成 |
| W3-06 | `perceptor/PortalTracker.ts`（`findVisibleOverlays` / `isOverlayRelatedToTrigger` / `waitForOverlay`，aria-controls/aria-owns/焦点/几何四重关联） | 完成 |
| W3-07 | `actuator/SelectAgent.ts` + `actuator/OverlayOptions.ts`（打开 → 枚举 → 滚动 → 匹配 → 正式点击 → 提交等待；`collectOptions` / `matchOption` / `findSearchBox`） | 完成 |
| W3-08 | `SelectAgent` 搜索优先路径（先 `findSearchBox` 输入再枚举；`searchSettleMs`） | 完成 |
| W3-09 | `actuator/CascaderWalker.ts`（`splitLevels` / `pathMatches` / 逐列 `waitForColumn` → 匹配 → 点击；外层浮层归一 `outermostOverlay`） | 完成 |
| W3-10 | `verifier/CommitPredicate.ts` combobox 分支（`COMPONENT_STATE` / `FORM_VALUE` → CONFIRMED；仅可见文本 → UNKNOWN `VISIBLE_ONLY`）；`perceptor/ComboboxState.ts`（`data-committed` / hidden input / 可见文本三源读取） | 完成 |
| W3-11 | `actuator/ExecutionBudget.ts`（三档预算：plain 8/5s、search 12/8s、cascader 18/12s；无进展熔断） | 完成 |
| W3-12 | 北森月份专项：`beisenMonth` 靶场 + `beisen-month.spec.ts`（1 / 10 / 11 / 12 精确陷阱 + 重渲染重跑） | 完成 |

### 关键算法与接口

- 波次分类：radio/checkbox 与含结构性关键词（学历/证件/地区/是否应届等）的 select 归 `STRUCTURAL`；combobox/date 与普通 select 归 `COMPLEX`；其余文本归 `LEAF`；顺序 `STRUCTURAL → COMPLEX → LEAF`。
- 屏障语义：每波执行后用安静窗口（DOM 无修订 200ms）确认联动结束；快照差分产出 `added/removed/valueChanges/optionChanges`；仅由 `added` 非空触发增量重扫（上限 2 轮），新字段按波次补执行。
- 动态依赖：差分归因到最近一次成功执行字段，记录 `FIELD_APPEARED / FIELD_DISAPPEARED / OPTION_CHANGED / VALUE_RESET`；检测到环时写入 `summary.cycles` 并降级为顺序执行。
- 选项匹配：先精确（文本归一或 `data-value`），纯数字目标禁用宽松匹配（防止 `1` 误选 `10/11/12`）；宽松为单向包含（防 `专业1` 误吸 `专业11`）；多重命中 → `AMBIGUOUS_OPTION`。
- 提交验证三态：组件状态（`data-committed`）或表单值（hidden input）匹配 → CONFIRMED；仅可见文本 → UNKNOWN（`VISIBLE_ONLY`，页面写 `NEEDS_MANUAL / COMMIT_UNKNOWN`）；均无 → UNKNOWN `NO_OBSERVABLE_STATE`。
- 终态 DirtyChecker：复查文本/日期字段与最终 `value` 读回；被联动清空的已填字段在预算内补填一次；用户接管字段跳过。
- 点击序列统一 `dispatchClickSequence`（pointerdown → mousedown → pointerup → mouseup → click），兼容 React/Vue 受控组件。

### 接口变化

- `RunSummary` 增 `waves`（每波统计）、`dependencies`（动态依赖边）、`cycles`（依赖环）、`dirty`（终态复查统计）。
- `ControlKind` 增 `combobox`；`ExecutableField` 上移至 `shared/contracts/field.ts`（scheduler 独立分区）。
- 新增可选 facts：`basic.location / city / postalCode / idType / idExplanation`、`education[].graduationYear / graduationMonth` 规则映射到 `endDate`；`normalize.ts` 透传。
- `resolveFieldKey` 对 combobox 触发元素改用 `FORM_CONTROL_SELECTOR`，保证用户操作保护可解析。

## 二、测试结果

### 通过测试

- 单元测试：26 个文件 / 208 个用例全部通过（新增 `scheduler.test.ts` 10 例、`selectAgent.test.ts` 9 例、`combobox.test.ts` 19 例）。
- E2E：17 个 spec 全部通过（W3 新增 5 个用例；W2 既有 12 个 spec 无回归）。
- 门禁：`typecheck` ✓ / `lint` ✓（仅 tsconfig 多项目提示）/ `build` ✓ / `test` ✓ / `test:e2e` ✓。

### 失败测试

- 无。

### 未运行测试

- 真实 ATS 网站（北森/Workday 等生产环境）未接入，按计划为 W5 范围。

## 三、实际验证范围

- 本地单元测试：WaveClassifier/WaveBarrier/WaveScheduler/依赖环/互斥、SelectAgent 全路径、CommitPredicate 三态、DirtyChecker、formatter 选项匹配。
- React 动态靶场（真实浏览器 + 加载构建产物扩展）：
  - `react-combobox`：搜索型门户下拉（输入过滤 → 正式提交）与虚拟滚动长列表（60 项滚动枚举）；
  - `react-cascader`：省/市/区三列级联逐列点击与提交路径验证；
  - `react-waves`：学历 → 专业（150ms 异步加载并清空）、应届 radio 门控毕业年份、证件类型=其他 → 证件说明（运行中增量重扫）、邮编清空城市（DirtyChecker 补填）；
  - `beisen-month`：年份列表 + 月份搜索框（`1` 与 `10/11/12` 精确区分），重渲染后重跑仍正确。
- Vue 靶场（W2）：重跑确认无回归。

## 四、已知问题

- 单控件双阶段日期（如"毕业时间"年月一体控件）尚未拆分处理，归 W4 DateAgent。
- combobox 无 `data-committed` / hidden input 的半受控组件只能报告 UNKNOWN（`VISIBLE_ONLY`），不视为成功，属预期保守策略。
- 增量重扫仅覆盖扁平字段（不重建实例区块）；区块内联动出现的新实例字段归 W4。
- `PortalTracker` 的几何关联在浮层紧邻无关元素时理论上可能误关联，已用 aria 属性优先缓解。

## 五、验收结论

PASS（G3：复杂 Select 和三波次调度通过）

## 六、下一步依赖

- W4：DateAgent（异构日期与年月一体控件）、跨域 Frame 观测、SPA 路由恢复与执行租约恢复。
- 北森月份回归已固化为 `beisen-month.spec.ts`，W4 日期能力扩展时须保持通过。
