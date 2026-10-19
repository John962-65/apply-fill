# Frame 恢复、路由数据持久化与事务验收

> 第四轮历史快照：当前验证、问题状态和安装包见 [本地开发交付说明](local-handoff-2026-10-18.md)。下方测试数字、包哈希及后续计划记录当时构建，ZIP 已由后续构建替换。

任务编号：W2-11、W4-05/06/07/09/10、W5-06 及第 11.5/12.4/12.5 节的相关缺口。
任务名称：继续按 `design.md` 重构存储与恢复链，修复多个执行上下文整份快照相互覆盖的问题。
日期：2026-10-18。

本报告承接 [经历路由与日期验收](routing-date-acceptance-2026-10-18.md)。全项目仍为 **PARTIAL**，目标保持 active；此次完成的存储范围不代替完整设计的剩余要求。

## 一、实现内容

| 文件与模块 | 实现行为 |
|---|---|
| `background/FrameRegistry.ts` | 通过 `chrome.storage.session` 保存版本化帧元数据；恢复时验证字段并过滤损坏记录；新注册、注销和关闭 Tab 不被迟到恢复覆盖；读取返回副本；最多保留 500 条帧元数据 |
| `background/BackgroundRuntime.ts`、`TabCoordinator.ts` | 注册信息使用浏览器提供的 URL、documentId 和真实 parentFrameId；Worker 恢复先与当前 Tab/Frame 树核对并清理，再中断旧 Run；导航取消旧任务，执行前探测清理已销毁帧；探测成功返回空列表时不使用过期快照伪造可达帧 |
| `FrameRegistry.ts` 写回队列 | 合并同一批待提交的修改，串行写回；`flush` 等待当前提交屏障，后续不断出现的帧活动不延长既有命令的确认；失败不会形成自动重试热循环 |
| 新增 `background/RoutingStore.ts` | ATS 缓存和映射记忆由扩展源的 IndexedDB 统一持有；数据库 `applyfill-routing` v1，包含 `atsMappings`、`mappingMemory`、`metadata`、`receipts` 四个 object store；Content Script 不访问网页源的 IndexedDB |
| `RoutingStore.ts` 事务 | 按字段提交增量，后台 read/modify/write 更新计数，不替换整个页面副本；来源更改中的缓存失效与记忆变更在同一事务提交；事务失败或任务失效回滚全部变更；批次收据避免重试重复计数；缓存/记忆分别限制 500 条，保留最近 1024 批收据 |
| `RoutingStore.ts` 迁移 | 迁入可验证的 cache schema 2 和 MappingMemory schema 2；集合、路径、相对索引及元数据再次校验；提交迁移标记后才删除旧 storage.local 副本及不再信任的 v1 记忆；重启后旧快照不会再次覆盖新记录 |
| 新增 `runtime/RoutingPersistence.ts` | 每次整页/单字段任务取得许可后加载当前站点视图；发送本地操作日志，成功后才确认对应前缀；失败保留同一批次 ID；晚到响应不能确认已经取消/替换的视图；读写等待可取消并有三秒上限 |
| `router/FingerprintCache.ts`、`memory/MappingMemory.ts` | 纯内存视图增加变更日志；加载快照不产生写回；查不到当前经历绑定时不执行相对路径，也不删除其他绑定实例仍可用的语义 |
| `BackgroundRuntime.ts` 授权 | LOAD/FLUSH 绑定当前 Run、Tab、Frame、documentId 与实际站点权限；站点来自 sender URL，不能通过载荷修改其他站点；事务中的每个写入边界再次检查任务有效性，拒绝旧 nonce 的迟到提交 |
| `runtime/ContentRuntime.ts` | 换来源原子提交缓存与记忆；若 DOM 已填写但偏好未保存，保留一条明确提示并允许重试，避免把保存失败当作已学习成功；修复该分支的重复行 |
| `shared/contracts/routing.ts`、协议、浏览器回归 | 路由持久化契约移至 shared；新增跨域缓存保留、嵌套帧清理、旧消息拒绝、迁移重启与存储故障恢复回归；旧路由测试改为读取实际扩展 IndexedDB |

接口变化：

- 新增 `LOAD_ROUTING { runId }`、`FLUSH_ROUTING { runId, batchId, cache, memory }`；消息传递的是字段上下文和 JSON Path 元信息。
- `FingerprintEntry`、`FingerprintCacheSerialized`、`MappingMemoryInput/Entry/Serialized` 在 shared 定义，原模块继续导出类型兼容既有引用；纯内存类新增 `pendingMutations` / `acknowledgeMutations`。
- `RoutingStore.load(host)` 返回站点视图；`apply` 接受增量批次与同步任务守卫，只有 IDB 事务完成后才返回成功。
- `FrameRegistry.ready` / `flush` / `captureRevision` / `reconcile` 支持恢复与浏览器树核对；session 键为 `applyfill.frames.v1`。
- 简历知识库及附件原有 IndexedDB 数据不参与此次迁移。执行许可、AbortController、DOM 引用和未完成动作不写入恢复快照。

## 二、测试结果

| 检查 | 当前结果 |
|---|---|
| `pnpm test` | PASS，50 文件 / 433 用例 |
| `pnpm typecheck` | PASS，两个 workspace |
| `pnpm lint`、`pnpm lint:boundaries` | PASS，8 个非法导入均被拒绝 |
| Chrome 全量 `pnpm test:e2e` | PASS，66 用例，3.0 分钟 |
| Edge 专项 | PASS，controlled / fill-native / lifecycle / upload / vue / llm-privacy / manual-transactions / route-context / datepicker / daterange / daterange-present / persistence / frames / memory 共 30 用例，1.3 分钟 |
| Testbed 生产构建 | PASS |
| Chrome / Edge ZIP | PASS，压缩完整性、Manifest V3、权限清单及包内全部 13 个文件匹配对应构建目录 |
| `git diff --check` | PASS |

环境：Linux x86_64；Node v24.17.0；Chrome for Testing 156.0.8078.4；Microsoft Edge 150.0.4078.48；Playwright headless、单 worker。以上时长为回归任务耗时，不代替性能 KPI。

安装包：

- `apps/extension/.output/applyfillextension-0.1.0-chrome.zip`
- `apps/extension/.output/applyfillextension-0.1.0-edge.zip`
- 当前 MV3 配置下两包相同，均为 **682,222 字节**；SHA-256：`9881c6f0573eea48739ddea05df917adcf8f6b7a31f5489421c62ef06cb51722`。
- 包内没有 `.env`，Manifest 未声明 debugger 或必选 `<all_urls>`；解压后可在浏览器扩展开发者模式加载目录。

新增单测检验并发写入不同键与同一键、批次幂等、站点/集合/路径拒绝、用户选择优先级、事务中途失败及取消、迁移失败不删除旧数据、容量淘汰；恢复测试检验迟到加载、旧 document、浏览器树清理、序列化副本、合并写回与有限提交屏障。

新增 `persistence.spec.ts` 五项真实浏览器回归：

1. 主帧更改来源后，主帧与 127.0.0.1 子帧先前的 ATS 缓存全部保留，新增来源只进入对应站点的记忆，旧 local 副本不存在。
2. 嵌套 iframe 记录实际父帧关系；移除父 iframe 后执行探测会清理父子元数据；主文档导航产生新的 documentId，关闭 Tab 后注册项清除。
3. schema 2 旧数据实际迁入扩展 IndexedDB；真实停止 Worker 后再运行，重新放入 local 的旧快照不会覆盖迁移后的记录。
4. 通过 Chrome scripting 的隔离环境发出真实 Content Script 消息，已结束 Run 的写入被拒绝，数据库保持不变。
5. 在真实 Worker 中注入 `QuotaExceededError`，核对缓存/记忆回滚、用户提示、恢复后的重试与重载学习结果。

`lifecycle.spec.ts` 的真实 Worker 停止用例同时检查帧元数据跨重启保留，以及旧任务变为 INTERRUPTED 且没有重放写入。

本轮存储故障回归确实暴露了重复提示：期望一行，实际两行。已用新的保存失败原因替换该字段旧 issue，原“一行”断言保留；修复后专项通过。为纳入故障处理与有限写回屏障的源码变更，先前两次部分全量执行主动停止，未计为通过；最终结果仅采用最新构建的完整执行。没有增加用例重试或跳过保护断言。

## 三、实际验证范围

本地单测使用 fake-indexeddb 验证事务及错误分支；浏览器测试使用真实扩展 Worker、Content Script、IndexedDB 和 chrome.storage.session，包含跨源 iframe、真实停止 Worker、导航销毁及存储异常。故障注入只发生在测试用临时浏览器上下文中。

本轮未运行真实 ATS 15 入口填写验收、独立标注准确率/覆盖率、性能与 Token KPI、远端 GitHub Actions。靶场数量、模拟域名和回归任务耗时均不替代这些证据。

## 四、已知问题与当前限制

- ATS 缓存和 MappingMemory 已完成集中增量存储；人工修正历史 `UserCorrectionStore` 与临时 JD 的更新仍有整份快照写回，多个上下文的合并、删除与追加竞争需继续修复。
- Frame 元数据有数量上限，执行时仍依赖浏览器重新探测当前树；极端高频导航、探测/状态保存挂起、全部权限撤销与任务初始化竞争尚需更完整的故障注入。
- 同构 SPA 步骤、多个同类 Section，以及无显式实例的集合路径选择策略仍需完善；持久化不会替代语义与身份的正确性验证。
- 日期初次异步装载、浮层根替换、范围首日延迟联动、多选 Select 与生产供应商提交证据继续补齐。
- 简历/岗位版本、GPA/奖项、完整切面选择与审核、附件逐字段报告等设计要求仍未全部完成。
- 59 项任务、25 类控件、RA/WS/WL、五大 Gate、真实 ATS、独立 KPI 和远端 CI 尚未全部取得当前证据。

## 五、验收结论

**PARTIAL**。Frame session 恢复与路由 IndexedDB 持久化取得当前实现及回归证据；整项目目标继续 active，不能把此次存储范围的完成作为全项目完成标准。

## 六、下一步依赖

继续修复人工修正/JD 多上下文更新与删除竞争、任务初始化取消边界，再推进 SPA 身份、日期剩余异步分支和简历版本产品流程。这些本地工作可继续执行。

真实 ATS 验收需要具体可使用页面和用户授权的测试资料/账号；独立 KPI 需要标注样本与单独计量。没有将缺少这些外部条件当作停止本地重构的理由。
