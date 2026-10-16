# Week 5 PATCH-01/02/04 专项回归（W5-10）

对应 design.md 6.7（RA01~RA10）、7.9（WS01~WS10）、9.12（WL01~WL15）三张验收表。覆盖方式：单测（vitest + jsdom）与真实扩展 e2e（Playwright）。运行：`pnpm -C apps/extension test`、`pnpm test:e2e`。

## PATCH-01 Reanchor Regression（RA）

| 编号 | 场景 | 覆盖用例 | 状态 |
|---|---|---|---|
| RA01 | React 整块 DOM 重建 | e2e `reanchor-remount.spec.ts`；unit `reanchorManager`：无历史快照时按顺序分配 / 全部值丢失的重绘进入安全停止 | 覆盖 |
| RA02 | 项目顺序改变 | unit `reanchorManager`：项目顺序改变时不按旧索引错误绑定（本批新增）；e2e `reanchor-delete-insert.spec.ts` | 覆盖 |
| RA03 | 中途插入空白项目 | unit `reanchorManager`：首位插入空白经历不影响原有绑定；e2e `reanchor-delete-insert.spec.ts` | 覆盖 |
| RA04 | 删除第二段项目 | unit `reanchorManager`：删除中间经历后剩余实例不索引错位；e2e `reanchor-delete-insert.spec.ts` | 覆盖 |
| RA05 | 两个项目同名 | unit `reanchorManager`：两段经历同名时拒绝盲目绑定；e2e `ambiguity.spec.ts` | 覆盖 |
| RA06 | 用户修改项目标题 | unit `reanchorManager`：用户修改标题后仍能匹配并保留实例身份；unit `contentWitness`：标题被修改时辅助证人仍可匹配；e2e `reanchor-remount.spec.ts` | 覆盖 |
| RA07 | 网页清空字段值 | unit `reanchorManager`：全部值丢失的重绘进入安全停止；unit combobox：漂移字段被识别并触发一次有界补填 | 覆盖 |
| RA08 | 同名字段顺序变化 | unit `identity`：sameLabelSiblingIndex 备用消歧；unit `reanchorManager`：同名字段数量变化时拒绝复用索引身份 | 覆盖 |
| RA09 | 区块重新挂载语义一致 | e2e `reanchor-remount.spec.ts`；unit `reanchorManager`：相同 DOM 顺序重跑全部命中且身份稳定 | 覆盖 |
| RA10 | 仅模糊结构证据 | unit `reanchorManager`：完全相同的快照与观察进入候选平局保护；e2e `ambiguity.spec.ts` | 覆盖 |

结论：重绘后身份恢复与“无法证明身份即安全停止”两条完成标准均有自动化证据，未发现错误继承路径。

## PATCH-02 Wave Scheduling Regression（WS）

| 编号 | 场景 | 覆盖用例 | 状态 |
|---|---|---|---|
| WS01 | 先选学历再填专业 | e2e `waves.spec.ts`（OPTION_CHANGED，专业=软件工程不回滚） | 覆盖 |
| WS02 | 省市区联动 | e2e `cascader.spec.ts`（逐列省/市/区，完整路径一致） | 覆盖 |
| WS03 | “至今”切换 | e2e `daterange-present.spec.ts`（2020-09-01 ~ 至今，本批新增）；unit `dateAgent`：范围+至今勾选 | 覆盖 |
| WS04 | 选项后生成新字段 | e2e `waves.spec.ts`（FIELD_APPEARED：证件说明/邮编被增量发现） | 覆盖 |
| WS05 | 日期修改后重绘文本框 | e2e `daterange.spec.ts`（提交镜像文本）；unit `dateAgent`：组合框范围提交按范围容忍比较 | 覆盖 |
| WS06 | 文本输入触发联动 | e2e `waves.spec.ts`（邮编与城市互清后 dirty.refilled≥1）；unit combobox：有界补填 | 覆盖 |
| WS07 | 独立输入框无冲突 | e2e `fill-native/controlled/vue/waves`（同波次多字段全部 VERIFIED）；unit `scheduler`：FIFO 串行。备注：引擎当前串行执行波内字段（保守实现，冲突为零） | 覆盖 |
| WS08 | 未知组件联动降级 | unit `scheduler`：记录依赖、去重、循环检测 + FIFO 串行传递；未知 controlKind 归 LEAF 波有界执行 | 覆盖 |
| WS09 | 依赖循环 | unit `scheduler`：记录依赖、去重、循环检测；runWaves 上报 cycles 且不阻塞整体 | 覆盖 |
| WS10 | Wave 中途取消 | e2e `cancel.spec.ts`（2 用例）；unit `scheduler`：超时与中止 | 覆盖 |

结论：已知联动全部通过；未知依赖以串行 + 有界收尾，不发生无限重试。

## PATCH-04 Write Transaction Regression（WL）

| 编号 | 场景 | 覆盖用例 | 状态 |
|---|---|---|---|
| WL01 | Agent 正常填写 | unit `guardRegistry`：获取租约并成功提交后释放锁；e2e 全量字段 VERIFIED 路径 | 覆盖 |
| WL02 | 输入前用户接管 | unit `userInteractionObserver`：真实事件触发 onUserEdit；unit `fieldExecutionEngine`：用户保护字段被跳过且不写入；e2e `user-protection.spec.ts` | 覆盖 |
| WL03 | 异步等待期间接管 | unit `fieldExecutionEngine`：revokeField 中止进行中的写入 / 已取消信号不写入；e2e `user-protection.spec.ts` 第 2 用例 | 覆盖 |
| WL04 | 下拉框展开后用户点击 | unit `userInteractionObserver`：捕获阶段记录 pointerdown，先于字段自身处理逻辑；e2e `user-protection.spec.ts`（接管即撤销租约，后续动作取消）。备注：未显式断言“焦点不被抢”，以租约撤销路径为准 | 部分覆盖 |
| WL05 | 修改已完成字段 | unit `guardRegistry`：用户编辑撤销活动租约并保护字段；e2e `user-protection.spec.ts` | 覆盖 |
| WL06 | 页面受控状态变化 vs 接管 | unit `userInteractionObserver`：非可信事件被忽略；e2e `controlled.spec.ts`（框架重渲染不触发接管） | 覆盖 |
| WL07 | 任务超时租约释放 | unit `guardRegistry`：过期租约 assertActive 判 LEASE_EXPIRED 并清理、TTL 钳制；长动作字段使用 MAX_ACTION_LEASE_MS | 覆盖 |
| WL08 | DOM 重绘旧租约失效 | e2e `reanchor-remount.spec.ts`（重绘后旧节点失联并重新绑定或安全停止）；unit `domRevisionTracker`。备注：lease.targetDomRevision 已预留字段，当前失效由身份层（ReanchorManager）+ revokeActive 承担 | 部分覆盖 |
| WL09 | Run 取消旧回调 | unit `fieldExecutionEngine`：已取消信号不写入 / checkpoint 抛错视为取消；unit `sessionStore`：SW 重启后不重放旧动作；e2e `cancel.spec.ts` | 覆盖 |
| WL10 | 两任务争抢字段 | unit `guardRegistry`：同一字段并发租约被拒绝 | 覆盖 |
| WL11 | 输入法组合输入 | unit `userInteractionObserver`：compositionstart 触发接管 | 覆盖 |
| WL12 | 点击无关区域 | unit `userInteractionObserver`：无法解析字段键不触发 / 插件 UI 内不触发 | 覆盖 |
| WL13 | 页面脚本 focus | unit `userInteractionObserver`：非可信（脚本合成）事件默认忽略 | 覆盖 |
| WL14 | 修改后重绘 FieldGuard 仍有效 | unit `guardRegistry`：用户编辑撤销并保护字段（状态独立于 DOM 节点）；e2e `user-protection.spec.ts` | 覆盖 |
| WL15 | 旧 Agent 延迟返回 | unit `guardRegistry`：旧事务延迟 assertActive 被拒绝（COMMITTED/RELEASED）；重复释放租约幂等（本批新增）；unit engine revokeField | 覆盖 |

结论：用户接管优先、撤销/过期租约不可产生写入、异步动作可安全退出三条完成标准均成立。WL04/WL08 为部分覆盖，已在 Week 5 验收报告中如实记录，不阻塞 P0 完成标准。

## 本批新增用例

- `reanchorManager.test.ts`：项目顺序改变时不按旧索引错误绑定。
- `guardRegistry.test.ts`：重复释放租约幂等且不重复解锁；旧事务延迟返回的 assertActive 被拒绝。
- `dateAgent.test.ts`：至今被容器包裹时优先点击可激活控件而非外层 div（同时修复 `DateAgent.findPresentControl` 的候选优先级缺陷）。
- `daterange-present.spec.ts`：日期范围“至今”端到端提交。
