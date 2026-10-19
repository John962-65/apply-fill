# 经历路由、映射记忆与日期异步导航验收

> 第三轮历史快照：最新验证与安装包见 [本地开发交付说明](local-handoff-2026-10-18.md)，第四轮见 [存储与恢复验收](persistence-acceptance-2026-10-18.md)。本文数字、ZIP 哈希和后续计划记录当时构建，安装包已由后续构建替换；剩余条目以最新交付说明为准。

任务编号：W2-08/09/11/12、W3-11、W4-01/10、W5-06/08 相关缺口。
任务名称：继续按 `design.md` 修复跨经历映射、主观题审核及日期慢响应问题。
日期：2026-10-18。

本报告承接 [首轮审计](refactor-audit-2026-10-18.md) 和 [事务与隐私修复](transaction-privacy-acceptance-2026-10-18.md)。全项目结论仍为 **PARTIAL**，目标保持 active；以下为本轮代码与明确测试范围的证据。

## 一、实现内容

| 修改与新增模块 | 实现行为 |
|---|---|
| 新增 `router/RouteContext.ts` | 路径白名单之外，复核路径所属集合与字段 Section，以及具体索引是否等于绑定 ResumeEntryId 对应的当前索引；项目文本切面也按同一条目约束 |
| `router/FastRuleMatcher.ts`、`runtime/planner.ts` | 项目区块的“职位/岗位”使用项目角色；教育/工作/项目/技能区块不自动读取其他集合或申请人资料；缓存不符合上下文时失效并回退规则；LLM 上下文冲突进入人工确认，避免错误指针直接执行 |
| `memory/MappingMemory.ts`、`ContentRuntime.ts` | 记忆 schema 升至 2；键包含步骤、语义组、name、约束、组件和选项的上下文哈希；已验证且属于当前绑定条目的选择转为 `[{index}]` 相对路径；跨条目或跨集合的明确选择只作用于当前字段，并清除该字段旧解释；拒绝旧版记忆与持久化的具体条目索引 |
| `perceptor/FieldDistiller.ts` | 提取最近的 fieldset / group 标签和区块标题作为语义组；同名的申请人、紧急联系人、推荐人字段拥有不同身份与记忆上下文；其他人信息不命中通用申请人姓名/电话规则 |
| `FieldDistiller.ts` 的标签提取 | 包裹式 label、label-for 和 aria-labelledby 提取时跳过嵌套控件正文，避免 Select 全部选项、textarea 默认正文与组合框当前值进入字段标签；遍历时跳过整个控件子树，保持标签身份独立于当前值 |
| `runtime/planner.ts`、`ContentRuntime.ts` | 已识别的主观题区块、未知 textarea，以及未知字段映射到简介切面的情况均需审核；缓存和人工映射记忆不能绕过下一次的主观题审核；悬浮组件呈现中文原因并允许显式选择来源或生成/编辑草稿 |
| `actuator/DateAgent.ts`、`ExecutionBudget.ts` | 翻月、十年翻页、年/月视图切换等待可观察状态变化，服从单步和字段总预算；loading 状态不算进展；Header/年份候选必须向目标推进才续租；到达总耗时边界即停止，避免多发一次点击；等待中取消阻止迟到面板触发后续动作 |
| `DateAgent.ts`、`DateViewClassifier.ts` | 隐藏面板不参与视图分类；禁用日期及其内嵌元素、非本月日期、隐藏候选与禁用导航不被点击；至今控制同样检查可用性；取消结果统一为 ABORTED |
| `background/ModelProvider.ts` | HTTP 错误响应体读取也受取消/超时约束；重试退避可被立即取消，下一次请求不会发出 |
| React 靶场与 E2E | 重复经历支持通用/未知角色标签变体；日期靶场支持有 loading 状态的延迟导航；新增跨条目记忆与审核回归，扩充日期慢响应、取消和模型退避测试 |

接口变化：

- `MappingMemoryInput` 增加 `context`、`boundEntryIndex`；后者用于证明相对来源，**不作为共享记忆键中的固定条目索引**。
- `MappingMemorySerialized.schemaVersion = 2`，当前存储键为 `applyfill.mappingMemory.v2`；旧 v1 不自动迁移为可信映射。用户可再次确认字段来源建立新记忆。
- `matchRule` 接受可选语义组标签；现有调用继续支持明确的平面字段规则。
- `DateAgentConfig.progressTimeoutMs` 默认 1800 毫秒，是可配置的单步观察上限，剩余字段预算更小时以剩余预算为准；没有把该时间当作固定成功等待。
- LLM 允许路径补齐项目起止日期及范围；自动执行前仍须通过集合、条目和数据校验。
- 新增人工原因 `ROUTE_CONTEXT_MISMATCH`、`DRAFT_REQUIRES_CONFIRMATION`。

## 二、测试结果

| 检查 | 当前结果 |
|---|---|
| `pnpm test` | PASS，47 文件 / 413 用例 |
| `pnpm typecheck` | PASS，两个 workspace |
| `pnpm lint`、`pnpm lint:boundaries` | PASS，8 个非法导入探针均被拒绝 |
| Chrome 全量 `pnpm test:e2e` | PASS，61 用例，2.8 分钟 |
| Edge 兼容复验 | PASS，controlled / fill-native / lifecycle / upload / vue / llm-privacy / manual-transactions / route-context / datepicker / daterange / daterange-present 共 23 用例，55.8 秒 |
| Testbed 生产构建 | PASS，含通用/未知项目角色与慢日期导航变体 |
| Chrome / Edge ZIP | PASS，压缩完整性、Manifest V3、权限清单及包内全部 13 个文件均匹配对应构建目录 |
| `git diff --check` | PASS |

环境：Linux x86_64；Node v24.17.0；Chrome for Testing 156.0.8078.4；Microsoft Edge 150.0.4078.48；Playwright headless、单 worker。测试耗时仅为回归执行时间，不代替性能 KPI。

安装包：

- `apps/extension/.output/applyfillextension-0.1.0-chrome.zip`
- `apps/extension/.output/applyfillextension-0.1.0-edge.zip`
- 当前 MV3 配置下两包相同，均为 **677,193 字节**；SHA-256：`1a2da56b774129e2f880be50d8add77ef5636092153303b3c76d20f92c8b920b`。
- 包内没有 `.env`，Manifest 未声明 debugger 或必选 `<all_urls>`；解压后可在浏览器扩展开发者模式加载目录。

重要回归证据：

1. 第二段项目选择 `projects[1].role` 后保存相对语义；重载页面、反转简历条目顺序，三个项目继续分别获得自己的角色。
2. 在第一段项目明确选择第二段项目的角色，当前字段正常写入；重载后三个未知角色字段均保持待人工处理，没有产生跨实例自动映射。
3. 有不同工作岗位数据时，项目内的“职位”仍填写各项目角色；单测同时拒绝错误集合、错误具体索引与缓存中的旧解释。
4. 未知主观 textarea 的模型建议经用户确认后能够写入；再次访问依然为空并要求审核，记忆不能绕过此步骤。
5. 日期 Header、十年候选与年月视图延迟 220 / 350 毫秒更新时仍能填写正确日期，没有在旧视图重复点击；等待中取消后迟到更新不会选日。
6. 日期无进展恰好两次熔断；朝错误方向翻页不触发进展续租；字段总预算耗尽不继续点击；禁用日期及其 span 无法通过合成事件绕过。
7. HTTP 错误响应体永不结束、重试退避中取消，两种情况下均返回 LLM_CANCELLED 且只发出一次请求。
8. 紧急联系人同名字段被模型建议使用申请人性别时，仍转人工且保持空值；申请人资料以外的分组不因目标未被列为敏感字段而绕过上下文检查。
9. 包裹 Select 的“性别”标签保持为“性别”，textarea 私人默认正文不进入标签，组合框当前值变化不会改变标签身份。

本轮专项首次执行有一处测试断言错误：把“定位”按钮的滚动高亮交互当作 focus。已改为断言第二段的具体字段收到高亮，保留条目定位和实际写入结果检查。另一个总预算边界用例发现 `>` 导致恰好到期后多点一次，已修正为到期即失效；保留原“只有一次点击”的断言。没有增加测试重试、跳过用例或删除写入保护检查。

Edge 首次新增联系人用例失败，进一步复现出包裹式 label 被识别为“性别请选择男女”的缺陷，导致模型测试匹配不到字段；同一逻辑还可能把 textarea 默认正文当作标签。新增单测在修复前确实失败（期望“性别”，实际“性别请选择男女”），修复标签提取后模型链路四项专项通过，再重新运行最终全量与双浏览器构建验证。没有通过改为模糊匹配标签避开这个缺陷。

## 三、实际验证范围

本地单测覆盖路由选择、绑定条目、记忆序列化与上下文、主观题审核、日期状态进展与动作预算、模型取消。浏览器测试使用实际打包扩展与 React/Vue 靶场，覆盖 Content Script、Worker 和消息链；模型响应由本地拦截，未调用真实外部服务。

本轮未进行真实 ATS 15 入口验收、独立标注准确率/覆盖率、性能与 Token 基准，也未验证远端 GitHub Actions。不能将靶场成功率、模拟域名或 E2E 任务耗时当作这些验收结果。

## 四、已知问题与当前限制

- 目前的经历路径校验依赖 SectionScanner 和绑定 ResumeEntryId 的正确性；同构 SPA 步骤、多组同类区块、生产站点的复杂歧义恢复仍须审计。平面字段的明确学校/学历规则保留现有行为；无显式实例的集合指针仍需完善单条/多条选择策略，不能由此推导所有语义都已识别。
- 日期本轮覆盖慢翻页与视图切换；初次日历异步装载、浮层根节点替换、范围首日选择后延迟联动等分支尚未获得完整故障注入证据。范围首段后仍有 settle 代码，需继续改为可观察联动状态。多选 Select 和供应商适配的真实提交证据也不完整。
- FrameRegistry 仍为内存，ATS 缓存仍使用 storage.local，尚未完成第 11.5 节的 session 元数据 / IndexedDB 存储迁移；跨帧并发更新记忆的合并语义仍需审查。
- 简历版本与岗位版本选择、GPA/奖项、完整切面选择与预览交互、附件合入逐字段持久化报告仍待完成。
- 59 项任务、25 类控件、RA/WS/WL、故障注入和五大 Gate 尚未全部取得当前证据；真实 ATS、独立 KPI 与远端 CI 继续缺失。

## 五、验收结论

**PARTIAL**。本轮修复是整项目的实际进展，不缩小原目标。完整设计的剩余范围继续见 [重构审计](refactor-audit-2026-10-18.md)。

## 六、下一步依赖

继续补齐 FrameRegistry / ATS 缓存持久化与多上下文更新，再完成日期剩余异步分支、简历版本模型与 Workbench 产品流程。这些本地工作没有因缺少真实 ATS 页面或账号而受阻。

真实 ATS 验收需具体可使用的页面与用户授权的测试资料/账号；独立 KPI 需建立标注样本、计量入口和符合设计公式的报告。未执行的项目保留为未验收，直到对应证据齐备。
