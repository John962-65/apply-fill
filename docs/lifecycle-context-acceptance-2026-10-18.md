# 任务生命周期、修正历史与岗位上下文验收

> 第五轮历史快照：最新验证、问题状态和安装包见 [本地开发交付说明](local-handoff-2026-10-18.md)。本文测试数字、包哈希及后续计划对应当时构建，安装包已由后续构建替换。

任务编号：W4-06/07/09/10、W5-04/06/07/12 相关缺口。
任务名称：按 `design.md` 继续修复启动与取消竞争、人工修正历史并发更新、岗位串用及存储访问边界。
日期：2026-10-18。

承接 [存储与恢复验收](persistence-acceptance-2026-10-18.md)。整项目结论仍为 **PARTIAL**，目标保持 active；本报告不代替完整设计的所有任务和门禁。

## 一、实现内容

| 修改文件 / 新增模块 | 当前行为 |
|---|---|
| `background/TabCoordinator.ts` | 整页任务与单字段/上传启动先取得全局执行槽；初始化、探测、帧响应、控制回执和结束回调均有等待上限；取消中断启动等待；单字段总预算从取得执行槽时开始计时；只有初始化完成后才授予写入授权 |
| `TabCoordinator.ts` 的任务守卫 | `assertActive` 同时验证归属、取消和结束状态；终态提交用 `assertCurrent` 验证仍是当前任务；晚到回调不得写新任务状态；导航取消携带事件发生时的 nonce；无活动任务时不发送无 nonce 的广播取消 |
| `TabCoordinator.ts` 取消回传 | 协作取消保留最多 250ms、且不超过控制等待预算的部分报告窗口；只接收相同 runId 的回传；无响应任务仍释放全局槽，不无限等待取消统计 |
| `background/SessionStore.ts` | 串行更新在读取前和读取后再次执行归属守卫；启动未落库时允许当前任务写入补偿终态；不得用旧启动/结束回调恢复已替换任务 |
| `background/BackgroundRuntime.ts` | 冷启动恢复快照在命令注册前取得，保留旧任务 nonce；新任务先预约执行槽再等待初始化；取消不等待启动完成；活动任务保持绑定目标；旧绑定恢复不能覆盖新绑定；单字段启动再核对实际 Frame/documentId |
| `entrypoints/sidepanel/App.tsx`、消息协议 | 命令带 requestId 与目标 Tab；过期命令响应不覆盖当前命令的 busy/notice；忽略较旧的同 Tab 状态；直接命令结果可提供终态报告；启动等待期间也可点击取消；信息刷新有版本检查 |
| 新增 `background/ContextStore.ts` | 修正历史和岗位上下文分别由后台串行处理增量操作；页面不再整份快照写回；旧键迁移在成功写入新键后才删除，迁移数据过滤多余属性 |
| `ContextStore.ts` 修正历史 | `applyfill.userCorrections.v2` 保存最多 200 条记录；ID 去重、删除标记防止迟到重试复活；清空轮换 epoch，旧客户端的新增/重试被丢弃；删除标记超过 2000 时轮换 epoch 并释放标记空间；host 和时间由后台确定，不接受页面伪造 |
| 新增 `runtime/CorrectionPersistence.ts` | 只提交新事件；旧加载/应答不会覆盖清空后收到的新 epoch；不会把被清空的旧事件重新绑定新 epoch 发送；读写等待最多三秒；后台将 epoch 变化单独发送到当前已注册文档 |
| `ContextStore.ts` 岗位上下文 | `applyfill.jdContext.v2` 最多 50 项、TTL 六小时；自动读取精确匹配 Tab、Frame、documentId 和完整 URL（含 hash）；同站不同职位及不同文档不自动共用；旧的按 host 缓存保留供手动选择，不自动分配到新页面 |
| `entrypoints/workbench/App.tsx` | 修正历史加载、删除和清空使用后台消息；较旧加载不会覆盖新列表；岗位列表按具体记录展示，提供「用于当前目标页」；用户明确选择的岗位优先于申请页再次嗅探，选择不延长原始 TTL |
| `shared/contracts/context.ts`、JD/历史模块类型导出 | 上下文与历史契约统一到 shared，原类型入口保留兼容导出；新增历史、JD 消息及 `RunSummary.error` |
| `entrypoints/background.ts`、`BackgroundRuntime.ts` 存储权限 | local/session 设置为 `TRUSTED_CONTEXTS`；内容脚本通过限定消息取所需信息，不直读写存储区；历史消息仅向内容脚本提供 epoch，不返回全站历史；模型配置修改及连接测试仅接受扩展页面调用 |

接口变化：

- 新增 `LOAD_CORRECTIONS`、`APPEND_CORRECTION { epoch, record }`、`REMOVE_CORRECTION { id }`、`CLEAR_CORRECTIONS` 和发往内容脚本的 `CORRECTIONS_EPOCH { epoch }`。
- 新增 `SAVE_JOB_CONTEXT { candidate, runId }`、`GET_JOB_CONTEXT`、`LIST_JOB_CONTEXTS`、`ASSIGN_JOB_CONTEXT { id, tabId }`；页面传入的 host/作用域不作为授权依据。
- `PANEL_COMMAND` / `COMMAND_RESULT` 支持 requestId；命令可指定目标 Tab；协调器回调增加任务守卫。
- ATS 缓存与 MappingMemory 仍由前轮扩展源 IndexedDB 管理；本轮历史位于 local、岗位位于 session，不持久化 DOM 引用、执行许可或动作队列。
- Chrome storage 的访问级别语义依据 [官方 Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)；实际拒绝效果由下述 Chrome/Edge 浏览器回归验证。

## 二、测试结果

| 检查 | 当前结果 |
|---|---|
| `pnpm test` | PASS，53 文件 / 455 用例 |
| `pnpm typecheck` | PASS，两个 workspace |
| `pnpm lint`、`pnpm lint:boundaries` | PASS，8 个非法导入均被拒绝 |
| Chrome 全量 `pnpm test:e2e` | PASS，70 用例，3.2 分钟 |
| Edge 全量 `APPLYFILL_E2E_BROWSER=edge pnpm test:e2e` | PASS，70 用例，3.6 分钟 |
| Testbed 生产构建 | PASS |
| Chrome / Edge ZIP | PASS，压缩完整性、Manifest V3、权限清单及各包 13 个文件均逐字节匹配对应构建目录 |
| `git diff --check` | PASS |

环境：Linux x86_64；Node v24.17.0；Chrome for Testing 156.0.8078.4；Microsoft Edge 150.0.4078.48；Playwright headless、单 worker。以上时长为回归任务耗时，不代替性能 KPI。

安装包：

- `apps/extension/.output/applyfillextension-0.1.0-chrome.zip`
- `apps/extension/.output/applyfillextension-0.1.0-edge.zip`
- 当前配置下两包相同，均为 **685,496 字节**；SHA-256：`92f1a2a898ac225362ece797687ef590f822f2a0f5b778491947e09e2a578d39`。
- 包内没有 `.env`；Manifest 未声明 debugger 或必选 `<all_urls>`，生产站点通过可选主机授权使用。

新增单测验证启动挂起、探测挂起、结束回调挂起、单字段初始化总预算、过期导航取消、取消回执挂起、迟到状态保存、40 个并发历史追加、ID 去重、删除/清空后的重试、迁移失败保留旧数据、200 条容量、不同职位/Frame/Tab/文档隔离、TTL、明确岗位选择优先级和 50 项容量。

新增或扩展真实浏览器用例：

1. 真实 Worker 的权限检查被延迟时，通过 SidePanel 启动并取消；页面保持空值；新任务完成后释放旧回调，新会话仍保持新 runId 和 COMPLETED。
2. 真实隔离环境同时提交历史增量；工作台显示全部记录；忽略、清空后发送旧请求均不恢复记录；清空后再通过 QuickFillPill 换来源可以正常新增记录。
3. Content Script 实际直读 local/session、直写 local、修改模型配置和触发连接测试均被拒绝；工作台模型配置可正常保存，测试密钥保持原值。
4. 同站两份 JD 各自读取正确公司；SPA URL 改变后不自动使用上一职位；明确选择后使用选定 JD，再次填写也不被页面嗅探覆盖。

回归期间发现并修复的失败：取消统计因立即丢弃原消息回传而归零，现增加有界协作窗口，保留原取消计数断言；同站 SPA 用例首次被测试辅助函数的 URL hash 匹配阻挡，辅助函数按 Chrome tabs URL 匹配方式去除查询匹配中的 hash，业务作用域仍保留完整 hash。类型检查发现侧栏闭包的 nullable state 和测试 ID 工厂 UUID 推导过窄，均已修复。没有跳过用例、增加重试或删除保护断言。

## 三、实际验证范围

本地单测使用真实业务类与模拟存储检验异步竞争。浏览器测试使用真实扩展 Worker、Content Script、chrome.storage、扩展 IndexedDB、React/Vue 靶场、跨域帧和真实停止 Worker。权限等待与存储故障注入只作用于测试用临时浏览器上下文。

未运行真实 ATS 15 入口填写验收、独立标注的准确率/覆盖率、性能与 Token KPI、远端 GitHub Actions。靶场数量、模拟招聘域名及回归任务耗时不替代这些证据。

## 四、已知问题与当前限制

- 后台串行写入避免当前 Worker 中的快照覆盖；Chrome storage 原生调用一旦发出不能物理取消。协调器释放槽与回调归属有等待上限，原生存储永久挂起、取消后状态写回/广播的完整故障矩阵仍需补齐；不能声称任意平台故障均已覆盖。
- epoch 轮换会丢弃旧世代待发送的历史事件，这是清空和容量限制的明确边界；修正历史写入失败目前不会自动无限重试。映射偏好与历史记录分别保存，历史不是路由学习事务的一部分。
- JD 默认仅适用于同一具体文档和 URL；重载产生新 documentId 后需重新采集或明确选择。当前「用于当前目标页」作用于该 Tab 主帧，子帧的显式继承策略仍需完善。没有仅凭同 host 自动猜测岗位。
- 所有 Background 消息的完整调用方权限矩阵仍需审查；本轮专门验证模型配置/连接与存储区访问，不能扩展成任意消息均已经安全审计的声明。
- 同构 SPA stepId、多个同类 Section、无显式实例的集合路径选择仍需完成。
- Date 初次异步装载、浮层根替换、范围首日延迟联动、多选 Select 和生产供应商提交证据仍需补齐。
- 简历/岗位版本、GPA/奖项、完整切面选择与审核、附件逐字段报告尚未全部完成。报告中的跨段错填等指标也需要独立计量，不能把固定展示值当作准确率证据。
- 59 项任务、25 类控件、RA/WS/WL、五大 Gate、真实 ATS、独立 KPI 和远端 CI 尚未全部取得当前证据。

## 五、验收结论

**PARTIAL**。当前轮次修复生命周期及上下文存储的明确缺口；整项目目标继续 active，不以本轮本地测试通过代替全部设计完成。

## 六、下一步依赖

继续完善同构 SPA 身份、日期剩余异步分支、版本与完整切面审核流程；同时补齐原生存储故障及 Background 调用方权限矩阵。这些本地工作可继续执行。

真实 ATS 验收需要可使用的具体页面与用户授权测试资料；独立 KPI 需要标注样本与单独计量。缺少这些外部条件不妨碍继续本地重构。
