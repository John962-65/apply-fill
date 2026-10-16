# Week 2 验收报告

任务编号：W2-01 ~ W2-15（对应 design.md 的 W2-01 ~ W2-12）
任务名称：Repeater 拓扑、Content Witness 与字段重锚定
日期：2026-10-15
依据：`design.md` 第十二章 Week 2 任务表、完成标准与阶段门禁 G2

## 一、实现内容

### 修改/新增文件（按交付物）

| 任务 | 交付物 | 状态 |
|---|---|---|
| W2-01 | `shared/contracts/reanchor.ts`（证人/观察/快照/重锚结果/实例报告）；`resume.ts` 增 `projects`；`field.ts` 增 `MappingStatus.AMBIGUOUS`；`run.ts` 增 `instances` | 完成 |
| W2-02 | `identity/ContentWitness.ts`（`extractWitness` / `matchWitness` / `buildTopology` / `matchStableIds` / `witnessHasEvidence`） | 完成 |
| W2-03 | `identity/FormInstanceRegistry.ts`（按区块 `instance_NN` 分配、保留、占用查询、`entryIdsOwnedBy`） | 完成 |
| W2-04 | `identity/ReanchorManager.ts`（评分矩阵、匹配阈值、歧义边距、歧义与安全停止原因码） | 完成 |
| W2-05 | `perceptor/DOMRevisionTracker.ts`（防抖修订版本与安静等待） | 完成 |
| W2-06 | `perceptor/SectionScanner.ts`（区块头定位、实例容器聚类、添加控件识别）；`FormScanner.ts` 导出 `matchSectionKeyword` 并增 `findSectionHeading` | 完成 |
| W2-07 | `perceptor/RepeaterManager.ts`（有界扩容：次数/单次超时/总时长三重预算） | 完成 |
| W2-08 | `perceptor/FieldDistiller.ts`（作用域蒸馏 `distillScopedElements`、同标签回退、`readFieldValueText` / `readStableAttribute`） | 完成 |
| W2-09 | `router/FastRuleMatcher.ts`（`{index}` 模板 + 教育/项目实例化规则）；`RouteValidator.ts` 支持 `projects`；`router/FingerprintCache.ts` | 完成 |
| W2-10 | `router/BatchLLMRouter.ts`（批量 LLM 兜底骨架，默认关闭、无副作用） | 完成 |
| W2-11 | `runtime/planner.ts` 实例计划重写（cache > rule > llm）；`runtime/ContentRuntime.ts` 编排重写（扩容 → 重锚定 → 执行 → 快照刷新 → 缓存记录） | 完成 |
| W2-12 | 新增 9 个单测文件（identity/perceptor/router/planner），更新 4 个既有测试 | 完成 |
| W2-13/14 | `packages/testbed`：react-repeater / vue-repeater 靶场与 5 个新 spec | 完成 |
| W2-15 | 全量门禁与本周验收报告 | 完成 |

### 关键算法与接口

- 内容证人（Content Witness）：主证人（名称类字段，如学校/项目名称）+ 辅助证人（角色、描述、学历等），评分 `0.5 × primary + 0.5 × aux`，任一侧缺证据时封顶 0.45。
- 重锚定决策：总分 `stable 0.35 + witness 0.4 + context 0.15 + topology 0.1`；匹配阈值 0.60；歧义边距 0.15；同分争抢同一快照 → `SNAPSHOT_CONTESTED`，候选平局 → `CANDIDATE_TIE`，零匹配 → `NO_RELIABLE_EVIDENCE`（全部安全停止为 AMBIGUOUS）。
- 三层身份：ResumeEntryId → FormInstanceId（区块内稳定分配）→ DeterministicFieldKey（含 instanceId）；`sameLabelSiblingIndex` 仅在有值时参与主键，仍作备用消歧。
- 扩容：目标数量 = 简历条目数；每次点击后等待容器数增长（DOMRevisionTracker），上限 6 次 / 单次 2s / 总 10s。
- 快照生命周期：运行前用证人匹配恢复身份，运行后用填写结果刷新快照，歧义实例不刷新、不写缓存。
- 未匹配条目与空白槽位：删除的项目条目保留为 `MISSING`；新增空白槽位不继承条目，字段映射为 `NO_DATA / NO_RESUME_ENTRY`。

### 接口变化

- `RunSummary` 增 `instances: InstanceReport[]`（sectionType / containerIndex / instanceId / resumeEntryId / status / witnessPrimary / reason）。
- `MappingIssue.kind` 增 `AMBIGUOUS`、`REPEATER`。
- 样例简历升级为 3 条教育 + 3 条项目（`resume.project.1-3`）。
- `RepeaterManager` 依赖注入 `DOMRevisionTracker`（可选），内容脚本与单测共用。

## 二、测试结果

| 项目 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm typecheck` | 通过（extension + testbed） |
| 模块边界 | `pnpm lint` | 通过，0 错误（identity 仅依赖 shared） |
| 单元测试 | `pnpm test` | 23 文件 / 170 用例全部通过（W1 14/101 → 新增 9 文件 69 用例） |
| 构建 | `pnpm build` | 通过，`.output/chrome-mv3` 约 220.5 kB |
| E2E | `pnpm test:e2e` | 12 / 12 通过（W1 6 个 + W2 6 个） |

E2E 覆盖（对应任务书验收清单）：

1. Repeater 自动扩容：1 段教育/1 段项目 → 自动补齐 3/3 并逐实例填写，18 字段全部 VERIFIED，重跑身份 ID 完全一致。
2. 同标签不串写：三段教育/三段项目值一一对应，无跨段错填。
3. 整块重绘恢复身份：React `key` 重挂载后实例 ID 不变，用户改过的标题保持 `USER_OVERRIDDEN`，其余字段继续填对。
4. 删除中间项目：不索引错位，剩余槽位值正确，被删条目报 `MISSING`；重跑自动补空槽且空槽保持为空。
5. 插入空白项目：既有绑定不受影响，空白槽位 `NO_DATA / NO_RESUME_ENTRY`。
6. 两段经历同名：触发 `AMBIGUOUS`（`SNAPSHOT_CONTESTED`）人工确认，不盲目绑定、不覆盖同名值。
7. Vue 响应式重复表单：扩容、稳定重跑、删除中间项目同样通过。

失败测试：无。
未运行测试：真实 ATS 站点（属 Week 5 PATCH 验收范围）；BatchLLMRouter 真实 LLM 调用（骨架默认关闭）。

## 三、实际验证范围

- 单元测试：jsdom + vitest，覆盖证人提取/匹配、实例注册表、重锚定（删中、插空、同名、用户改名、值全丢、平局）、修订追踪、区块扫描、扩容预算、作用域蒸馏、实例计划与路由缓存。
- E2E：Playwright persistent context 加载构建后扩展，React/Vue 动态靶场真实扩容点击 + 键盘输入 + 重挂载/删除/插入/复制操作，断言 DOM 值、实例报告与映射问题。
- 真实 ATS 测试：未进行。

## 四、已知问题

- 靶场注意：React StrictMode 会双调用 state updater，副作用（uid 自增）必须放在 updater 外，否则测试页面 ID 漂移（已修复）。
- 自动扩容策略：用户删除中间项目后重跑会按简历条目数自动补一个空槽（空白不填）。属设计行为，但产品化时需确认是否应尊重用户的删除意图。
- 运行中途的整块重绘仍走安全兜底（`NEEDS_MANUAL`），不做事后重锚定；按计划属 Week 3/W4 增强。
- `BatchLLMRouter` 为默认关闭骨架，未接入真实模型与置信阈值调参。
- `FingerprintCache` 只记录规则/LLM 来源的模板（不含 `{index}` 具体值），跨站点泛化能力依赖于规则命中率。
- 简单文本区域以外的复杂组件（自定义 Select、级联）不在 Week 2 范围，属 Week 3 任务。
- 尚未配置 CI。

## 五、验收结论

对比 Week 2 完成标准：

1. 三段教育/三段项目自动扩容 —— 通过（repeater-fill / vue-repeater）。
2. 同标签不串写 —— 通过（逐实例值断言，跨段错填 0）。
3. 删除中间不错位 —— 通过（delete-insert 用例，项目 3 值不落到项目 2 位置）。
4. 插入空白不影响绑定 —— 通过（空白保持空、既有实例 ID 不变）。
5. React 整块重绘恢复身份 —— 通过（重绘前后实例 ID 完全相等）。
6. 同名经历不盲目绑定 —— 通过（AMBIGUOUS 安全停止）。
7. 用户改标题仍保护 —— 通过（USER_OVERRIDDEN、其余字段继续填对）。
8. 身份不定触发人工确认 —— 通过（AMBIGUOUS issue + 不执行写入）。
9. 逻辑身份与 DOM 生命周期解耦 —— 通过（快照 + 证人重建，不依赖元素引用）。

**PASS（阶段门禁 G2 通过）**

## 六、下一步依赖

- Week 3 依赖：WaveClassifier、WaveScheduler、WaveBarrier、SelectAgent、PortalTracker、CascaderWalker、复杂组件 CommitPredicate。
- 需在 Week 3 前后补齐：CI 工作流、BatchLLMRouter 真实接入、覆盖率报告。
- 潜在影响项：运行中途重绘的事后重锚定（当前安全兜底）与三波次调度中的重扫衔接。
