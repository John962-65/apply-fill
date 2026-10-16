# Week 1 验收报告

任务编号：W1-01 ~ W1-12
任务名称：工程底座、状态契约与最小填写闭环
日期：2026-10-15
依据：`design.md` 第十二章 Week 1 任务表、完成标准与阶段门禁 G1

## 一、实现内容

### 修改/新增文件（按交付物）

| 任务 | 交付物 | 状态 |
|---|---|---|
| W1-01 | `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`.gitignore` | 完成 |
| W1-02 | `apps/extension/`（WXT 0.21.4 + React 18 + TS 5.9，MV3） | 完成 |
| W1-03 | `eslint.config.js`（模块单向依赖 zones + DOM 禁用规则） | 完成 |
| W1-04 | `src/resume/`（facts → normalized → projections 三层编译 + IndexedDB 存储） | 完成 |
| W1-05 | `src/shared/messages/`（TabMessage / BackgroundMessage / PanelPortMessage 协议与客户端） | 完成 |
| W1-06 | `src/identity/`（`buildFieldIdentity`、FNV-1a 64 位确定性字段键 `fk1_<hex16>`） | 完成 |
| W1-07 | `src/guard/`（`GuardRegistry`、`UserInteractionObserver`、`WriteTransactionLease` TTL 3s/上限 10s） | 完成 |
| W1-08 | `src/actuator/Primitives.ts`（原生 setter + input/change 派发、select/checkbox/radio 原语） | 完成 |
| W1-09 | `src/verifier/CommitPredicate.ts`（DOM_VALUE / SELECTED_OPTION / ARIA_STATE 证据 + 稳定性窗口） | 完成 |
| W1-10 | `packages/testbed/`（react-native / react-controlled / vue-controlled 靶场） | 完成 |
| W1-11 | `apps/extension/tests/unit/`（14 文件 101 用例）+ `packages/testbed/e2e/`（6 用例） | 完成 |
| W1-12 | `src/entrypoints/sidepanel/`（启动、暂停/恢复、取消、进度与结果查看，不自动提交） | 完成 |

### 关键算法与接口

- 扫描 → 蒸馏 → 规则路由 → 格式化 → 租约执行 → CommitPredicate → 摘要的完整闭环（`src/runtime/ContentRuntime.ts`、`src/runtime/planner.ts`）。
- 字段身份：规范化描述符（formId / stepId / sectionType / label / controlKind / 消歧字段）经 FNV-1a 生成稳定键，`sameLabelSiblingIndex` 不参与主键。
- 写事务：`acquire → assertActive → 写 → 验证 → markVerified / release`，用户接管时 `noteUserEdit` 撤销租约并锁定字段。
- 用户接管观察：只采信 `isTrusted` 事件，排除插件 UI（`[data-applyfill-ui]`），并跳过 Agent 持有活动租约期间的字段事件（见"已知问题"）。
- 提交判定：稳定性窗口 `stepMs=60 / requiredStableReads=2 / maxElapsedMs=320` 后执行控件级谓词。

### 接口变化

- `UserInteractionObserver` 新增 `isAgentWriting` 注入项与导出的 `isTrustedUserEvent` 纯函数（测试可用性）。
- 扩展配置采用 `srcDir: 'src'`，entrypoints 位于 `src/entrypoints/`（WXT 0.21 `@` 别名固定指向 srcDir）。

## 二、测试结果

| 项目 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm typecheck` | 通过（extension + testbed） |
| 模块边界 | `pnpm lint` | 通过，0 错误 |
| 单元测试 | `pnpm test` | 14 文件 / 101 用例全部通过 |
| 构建 | `pnpm build` | 通过，`.output/chrome-mv3` 约 199 kB |
| E2E | `pnpm test:e2e` | 6 / 6 通过（真实 Chromium 加载构建后扩展） |

E2E 覆盖（对应任务书验收清单）：

1. 原生表单：text / tel / email / textarea / number / select / checkbox / radio 全部 VERIFIED，未映射字段保持空值；输入后失焦值保持。
2. React 受控组件：写入后经两次重渲染与失焦仍保持，状态由受控 state 驱动。
3. Vue 受控组件：v-model 同步，重渲染后保持。
4. 用户输入保护（执行前）：用户键入的字段保持 USER_OVERRIDDEN，Agent 不覆盖。
5. 用户输入保护（执行期间接管）：运行中键入学校名称，该字段 USER_OVERRIDDEN，其余字段继续完成。
6. 任务取消：取消后无新增写入，摘要状态 CANCELLED。

失败测试：无。
未运行测试：真实 ATS 站点（属 Week 5 PATCH 验收范围，本阶段不宣称）。

## 三、实际验证范围

- 本地单元测试：jsdom 环境，覆盖身份键、租约、观察器、原语、谓词、稳定性、路由、格式化、扫描/蒸馏、规划、执行引擎、简历编译与存储、暂停门。
- React/Vue 动态靶场：本地 Vite 靶场（`http://localhost:5173`），Playwright persistent context 加载编译产物扩展，使用真实键盘键入验证接管路径。
- 真实 ATS 测试：未进行。

## 四、已知问题

- WXT 0.21 的 `alias['@']` 会被内部 srcDir 覆盖，已通过 `srcDir: 'src'` + entrypoints 迁移至 `src/` 对齐，后续模块请继续使用 `@/` 前缀。
- Chromium 中程序化 `element.click()` 触发的 input/change 事件 `isTrusted` 为 true（已用探针实证），已通过"活动租约期间的字段事件不视为用户接管"规避；该窗口仅覆盖点击瞬时，E2E 5/6 号用例验证了运行中真实键入仍被正确接管。
- 复杂组件（antd/Element 受控包装、contenteditable、日期组件）不在 Week 1 范围，属后续 Wave/PATCH 任务。
- 尚未配置 CI（GitHub Actions 属后续交付物）。
- 映射能力仅本地规则表（11 条），未知字段安全回落为 UNMAPPED。

## 五、验收结论

对比 Week 1 完成标准：

1. 工程构建通过 —— 通过。
2. ESLint 模块边界生效 —— 通过（zones 全量配置，当前 0 违规）。
3. 标准字段可填写并验证 —— 通过（8 类控件 E2E 全绿）。
4. 用户接管机制最小版本正常 —— 通过（执行前/执行期间两类接管用例）。
5. 所有成功状态由 CommitPredicate 决定 —— 通过（执行引擎仅依据谓词结果标记 VERIFIED）。
6. Playwright 在真实浏览器加载编译扩展执行测试 —— 通过。

**PASS（阶段门禁 G1 通过）**

## 六、下一步依赖

- Week 2 依赖：SectionScanner、RepeaterManager、ContentWitness、ReanchorManager、DOMRevisionTracker、Scoped FieldDistiller、FastRuleMatcher/Formatter 增强（部分已于 W1 预置基础版本）。
- 需在 Week 2 前后补齐：CI 工作流、覆盖率报告、FingerprintCache 与 BatchLLMRouter 基础版本。
- 潜在影响项：字段身份在重绘后的恢复策略将替换 `elementByKey` 的即时重扫兜底（`ContentRuntime.resolveElement`）。
