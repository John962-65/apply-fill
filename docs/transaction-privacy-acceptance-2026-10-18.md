# 写入事务、统一任务许可与云端路由隐私验收

> 第二轮历史快照：最新测试与安装包见 [本地开发交付说明](local-handoff-2026-10-18.md)，经历路由/日期修复见 [第三轮验收](routing-date-acceptance-2026-10-18.md)。本文测试数字、ZIP 哈希及后续计划记录第二轮构建，安装包已由后续构建替换；已知问题条目以最新交付说明为准。

任务编号：W1-07/08、W2-07/12、W3-07/09/11、W4-06/07/09/10/11、W5-04 及 PATCH-04 的相关缺口修复。
任务名称：继续依据 `design.md` 重构项目，补齐真实动作边界、单字段/上传生命周期和模型请求边界。
日期：2026-10-18。

本报告是继 [首轮审计](refactor-audit-2026-10-18.md) 后的第二轮快照。结论为 **PARTIAL**；下述测试只证明列出的范围，整项目目标仍为 active。

## 一、实现内容

| 实现 | 文件与模块 | 关键行为与证据 |
|---|---|---|
| 动作前同步复核 | `shared/contracts/action.ts`、`shared/utils/action.ts`、`actuator/Primitives.ts`、Select/Cascader/Date Agent | 在 focus、setter、input/change 事件、点击链的每个实际动作前检查信号和租约；页面同步事件回调使任务失效时停止后续动作 |
| 实际 DOMRevision 与身份复核 | `perceptor/DOMRevisionTracker.ts`、`runtime/FieldBinding.ts`、`actuator/FieldExecutionEngine.ts`、`runtime/ContentRuntime.ts` | 读取 revision 前排空待处理 MutationRecord；允许无关 DOM 变化前必须证明同一节点仍为原字段；节点被复用为不同 name、标签、语义组或经历实例时撤销租约并报告 IDENTITY_LOST |
| 有界取消与续租 | `shared/utils/timing.ts`、`guard/GuardRegistry.ts`、`actuator/FieldExecutionEngine.ts`、`actuator/DateAgent.ts` | `withAbort` 让不响应信号的等待及时退出，并观察迟到的 Promise；日期仅在实际面板/标题进展时续租；租约续期不得超过字段总剩余预算，也不能复活已失效租约 |
| 手动操作与整页填写共用许可 | 新增 `runtime/FrameTaskRunner.ts`；修改 `background/TabCoordinator.ts`、`BackgroundRuntime.ts`、`ContentRuntime.ts` | 换来源、单字段重试、主观题写回和附件上传均先占用本地槽位，再取得全局许可；双击、跨帧、跨 Tab 与整页任务互斥；取消中的迟到许可用原 nonce 释放；无响应执行器不会无限占有许可 |
| 当前执行帧授权 | `TabCoordinator.ts`、`BackgroundRuntime.ts`、`shared/messages/protocol.ts` | 当前 runId、Tab、frameId、documentId 和站点权限共同决定是否允许继续；等待中的其他帧不能发起模型请求；Worker 重启后的旧任务在下一个检查点失效；整页/手动/上传在动作前检查后台授权 |
| 手动结果与整页报告合并 | `background/SessionStore.ts`、`shared/contracts/run.ts`、`ContentRuntime.ts` | 辅助任务保留原整页报告；只合并来源帧的字段变化和计数差额；旧 document/run 不可释放新任务或改写报告；显式人工编辑使用 REPORT_UPDATED，与迟到的 RUN_FINISHED 区分 |
| 等待候选与上传确认 | `SelectAgent.ts`、`FileUploadAgent.ts`、Testbed 上传页 | 自定义 Select 根据候选、搜索框和 loading 状态等待；上传取消能打断确认轮询；注入后用户替换文件、输入节点脱离、网站仅显示旧文件名均不能当作本次成功 |
| 模型路由元信息隐私 | 新增 `router/MetadataPrivacy.ts`；修改 `PromptBuilder.ts`、`background/LLMGateway.ts`、`ContentRuntime.ts` | Content 与 Background 分别依据本地事实清洗标签，过滤长文本、已知事实值、常见邮箱/电话/身份证/网址；原始 FieldKey 不出网，使用 route_N 临时别名；本地审查失败时停止请求 |
| 模型取消与人工确认 | `background/ModelProvider.ts`、`LLMGateway.ts`、`runtime/planner.ts`、`ContentRuntime.ts` | 模型调用绑定获授权的当前 Run；取消、超时或关闭云端设置会中止请求；取消不触发重试；LLM 建议的个人资料和薪资指针须用户换来源确认后执行，确认后清除待审问题 |

主要接口变化：

- `ActionGuard` / `assertActionAllowed` 在共享层定义同步动作守卫；Agent 接受可选 `assertActive` 回调。
- `FieldEngineDeps` 增加 `getDomRevision`、`isIdentityValid`；`DateAgent` 增加真实进展 `onProgress`。
- `GuardRegistry.renew(lease, ttlMs, absoluteDeadline)` 限制续租到绝对总预算。
- `ACQUIRE_FRAME_TASK` / `RELEASE_FRAME_TASK` / `CHECK_RUN_AUTH` 加入后台协议；任务带 runId、操作种类和浏览器提供的 frame/document 身份。
- `LLM_ROUTE_FIELDS` 绑定 runId；`ModelProvider.complete` 接收父级 AbortSignal；`LLMGateway.cancelRun` 中断对应网络任务。
- `RunSession.operation` 标记 field/upload 辅助任务；新增 `REPORT_UPDATED` 事件用于显式用户操作。

## 二、测试结果

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | PASS，两个 workspace |
| `pnpm lint` | PASS |
| `pnpm lint:boundaries` | PASS，8 个非法导入均被拒绝 |
| `pnpm test` | PASS，47 文件 / 386 用例 |
| 最后一次 Chrome 全量 `pnpm test:e2e` | PASS，54 用例，2.4 分钟 |
| 最后一次 Edge 兼容复验 | PASS，controlled / fill-native / lifecycle / upload / vue / llm-privacy / manual-transactions 共 12 用例，24.4 秒 |
| Testbed 生产构建 | PASS |
| Chrome / Edge ZIP | PASS，压缩完整性、Manifest V3、权限清单与包内全部 13 个文件匹配各自构建输出 |
| `git diff --check` | PASS |

环境：Linux x86_64；Node v24.17.0；Chrome for Testing 156.0.8078.4；Microsoft Edge 150.0.4078.48；Playwright headless、单 worker。回归任务耗时不替代第 3 章性能 KPI。

安装包：`apps/extension/.output/applyfillextension-0.1.0-chrome.zip`、`apps/extension/.output/applyfillextension-0.1.0-edge.zip`。当前 MV3 配置下两包相同，均为 **674,717 字节**，SHA-256：`95af43c8274a7c9fd8e91967380182db7b370e7b7b09f97f2937245740f69828`。逐文件与可加载构建目录比对通过；没有 `.env`、debugger 或必选 `<all_urls>` 权限。浏览器扩展开发者模式可加载解压后的目录。

新增重点用例：同一 DOM 节点 name 改变、经历实例迁移、DOMRevision 中途变化、日期按进展有界续租；辅助许可双击/迟到授予/无响应动作/拒绝释放；其他帧与旧 document 授权；模型实际请求体清洗与别名恢复；模型取消不重试；上传被用户替换。

新增浏览器回归位于 `manual-transactions.spec.ts` 和 `llm-privacy.spec.ts`：

1. 单字段换来源等待 loading 候选期间取消，稍后出现的选项没有被点击，取消结果进入原报告。
2. 附件等待网站确认期间整页填写被拒绝；取消后迟到的成功提示不把本次上传改判为成功。
3. 截获真实扩展 Worker 发出的模型请求体，断言已知个人资料与原始字段键不出网；模型返回个人资料指针后输入仍为空，用户明确选择来源后才写入。
4. 模型响应被挂起时取消填写，任务在两秒内结束，不等待十秒服务超时，也不继续重试。

本轮曾暴露两处问题并已修复：确认来源后待审问题仍显示；空列表测试在迟到选项出现后才发出取消。后者改为真实可见 loading 状态，并补齐 Select 的状态等待，保留迟到选项不得点击的断言。没有通过跳过用例、删除保护断言或设置重试掩盖失败。

## 三、实际验证范围

- 本地单测检查同步竞争、租约、许可、状态合并和隐私审查分支。
- React/Vue 靶场使用实际扩展 Content Script、Worker、SidePanel 与消息通道，覆盖原有填写、联动、重复经历、重绘、SPA、跨帧、权限及新增取消/隐私流程。
- 云端回归通过本地拦截模型响应检查实际 HTTP 请求体；没有向真实外部模型发送简历数据。此证据不等于所有未知隐私形式已被穷尽验证。
- 真实 ATS 的 15 个入口没有本轮填写验收结果；模拟域名与靶场不计入真实 ATS 成功率。独立准确率、覆盖率、性能和 Token KPI 未验收，远端 GitHub Actions 尚未运行验证。

## 四、已知问题与当前限制

以下均为全项目继续工作的范围，不能因为当前回归通过而忽略：

| 范围 | 剩余工作 |
|---|---|
| 路由上下文与映射记忆 | 通用“职位”等规则尚需严格限定已确认 Section；MappingMemory 记录具体经历索引的方式可能向其他实例复用，需按绑定 ResumeEntryId 归一化或拒绝跨实例记忆；缓存/LLM 路径白名单还须核对所属集合与绑定条目 |
| 主观题确认 | 现有草稿写回需显式确认；未知 textarea 被云端映射到普通个人简介路径时，还需单独审查是否绕过草稿审核 |
| 日期异步导航 | 当前可按真实进展有界续租；慢于现有 settle 窗口的标题更新仍可能误判无进展，需要基于状态变化的有界等待和慢响应回归 |
| 简历产品与事实模型 | 简历版本、岗位版本选择、GPA/奖项等事实、切面选择与完整预览流程尚未完全符合第 5/13 章 |
| 身份与调度 | 同构 SPA 步骤、多组同类 Section 的身份边界，以及所有动态降级和故障注入仍需逐条审计 |
| 持久化 | FrameRegistry 仍在内存；ATS 缓存仍使用 storage.local，尚未迁至设计要求的 session 元数据 / IndexedDB 实现 |
| 组件与提交验证 | 多选 Select、供应商复杂控件、无靶场状态钩子的真实提交证据仍不完整；暂停和长异步任务的全部生命周期分支继续复验 |
| 上传报告 | 上传反馈能如实呈现取消/失败；附件尚未完整合入持久化的逐字段结果与来源追踪，部分拒绝响应的会话终态需要继续细化 |
| 最终门禁 | 59 项任务、25 类控件、RA/WS/WL、故障注入及五大 Gate 应按当前实现重新建立完整证据；真实 ATS、独立 KPI 和远端 CI 仍缺 |

## 五、验收结论

**PARTIAL**。本轮修复范围具有单测与浏览器证据，整体目标继续 active。未宣称整项目所有 bug 已修复，也未将剩余工作仅归结为真实 ATS 访问条件。

## 六、下一步依赖

优先修复经历路由的 Section/条目边界与 MappingMemory 索引复用，再完成日期慢异步状态等待、Frame/缓存持久化和简历版本产品流程。这些本地工作可以继续进行，不依赖真实站点账号。

真实 ATS 验收需要可使用的具体页面与用户授权的测试资料/账号；不能用未验证的“站点不可访问”代替执行结果。独立 KPI 需单独建立标注样本与计量入口，功能 E2E 耗时不替代 KPI。
