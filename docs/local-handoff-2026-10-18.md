# 本地开发交付与测试说明

> 历史交付快照：后续 AI 解析、审核界面及最新安装包见 [2026-10-21 改进说明](resume-ai-review-2026-10-21.md)。以下哈希和测试数字仅对应当时构建。

任务编号：V2.1 / W1–W5 开发收尾。
任务名称：依据 design.md 重构简历填写项目并修复本地回归发现的缺陷。
日期：2026-10-18。

本次按用户安排交付源码和 Chrome / Edge 安装包，真实招聘网站由用户本地测试，反馈后继续修复。本文是当前交付入口；此前阶段报告中的测试数字、问题清单和安装包哈希是历史快照。

## 一、实现内容

| 范围 | 已交付行为 | 主要源码 |
|---|---|---|
| 工程与四端 | WXT MV3 扩展、Workbench、SidePanel、Content、Background 与 React/Vue 靶场；依赖边界检查和 CI 工作流 | `apps/extension/src/entrypoints/`、`eslint.config.js`、`.github/workflows/ci.yml` |
| 简历知识库 | 原始事实校验、规范化、项目切面编译、JSON 导入/编辑/导出；本地 PDF 解析后确认导入；GPA、奖项、补充信息；重复章节累加保留 | `resume/schema/validate.ts`、`resume/compiler/`、`resume/parser/` |
| 简历版本 | 每次导入保留版本，支持命名、切换和删除；保留最近 20 个；禁止任务中切换；清空会删除所有简历版本；切换后内容脚本旧计划失效 | `resume/storage/resumeStore.ts`、`background/BackgroundRuntime.ts`、`entrypoints/workbench/App.tsx` |
| 字段身份与经历 | 确定性字段键、内容证人、一对一重锚定；多段教育/项目/工作扩容；同一步骤多个同类区块统一计算；跨原生表单或嵌套争用时转人工；单字段明确选来源 | `identity/`、`perceptor/`、`runtime/planner.ts`、`runtime/ContentRuntime.ts` |
| 写入和验证 | 三波次调度、动态依赖、浮层互斥；WriteTransactionLease 在动作前复核身份与取消；组件提交验证、终态复检和有界恢复；用户接管保护 | `guard/`、`scheduler/`、`actuator/`、`verifier/` |
| 复杂日期 | 等待初始异步加载，重定位替换后的关联浮层；按实际进展有界续租；范围起点确认、终点延迟联动与提交等待；不补造缺失的日期精度 | `actuator/DateAgent.ts`、`shared/utils/date.ts` |
| 网页生命周期 | Tab 级统一协调整页、单字段与附件任务；跨域帧授权与聚合；SPA 步骤隔离和返回步骤保护；取消迟到动作；Worker 恢复后中断旧任务 | `background/TabCoordinator.ts`、`background/SessionStore.ts`、`runtime/StepObserver.ts`、`runtime/FrameTaskRunner.ts` |
| 消息和数据边界 | 每个后台 API 明确调用方策略；以浏览器当前 Tab/Frame/documentId/URL 和真实权限授权；私有数据绑定活动任务，读取后复核；校验运行事件/摘要；取消或权限失效后仍允许原持有者释放任务 | `background/MessageAuthority.ts`、`background/MessageRouter.ts`、`shared/messages/validateRun.ts` |
| 路由与持久化 | 本地规则、指纹缓存、映射记忆和可选模型指针；缓存 IndexedDB 增量事务；人工修正 epoch 防止删除后复活；local/session 限可信扩展上下文；模型调用随 Run 取消 | `background/RoutingStore.ts`、`runtime/*Persistence.ts`、`router/`、`background/LLMGateway.ts` |
| 岗位与主观题 | JD 绑定采集页面；用户选择才应用到当前页和授权子帧；最多保存 20 个本地岗位版本；可选项目及不同切面生成草稿，编辑确认后才执行验证写入 | `background/ContextStore.ts`、`jd/`、`ui/QuickFillPill.tsx` |
| 附件 | Base64 跨环境传输、内容和大小核验；等待期间用户选文件即停止覆盖；网站确认/拒绝/未确认分别报告；失败任务不伪装为完成 | `resume/storage/attachmentStore.ts`、`actuator/FileUploadAgent.ts`、`runtime/ContentRuntime.ts` |
| 报告 | 未映射字段纳入人工处理数量；显式选来源后更新对应字段；整页/单字段/附件操作分别标识；跨帧更新拒绝过期来源；未独立测量的指标明确显示未测量 | `shared/utils/runReport.ts`、`background/SessionStore.ts`、`entrypoints/sidepanel/App.tsx` |

接口与迁移：

- 附件消息采用 `dataBase64`；内容脚本读取编译简历或附件时携带活动 `runId`。运行事件和任务释放摘要会验证类型、边界及来源。
- 新增简历版本列表/切换/删除、岗位版本保存/列表/使用/删除消息；这些管理 API 仅接受扩展页面。新增 `RESUME_CHANGED` 通知使旧内容计划失效。
- 简历编译版本为 2；旧编译记录从经过校验的原始事实重新编译。已有单一简历在后续导入时纳入版本历史；附件库保持独立。
- FieldKey 与 ATS 缓存采用 schema 2；旧字段租约不恢复，旧版缓存不自动信任。修正历史采用 v2 增量与 epoch；岗位临时上下文采用 v2 精确页面作用域。
- 岗位版本保存于可信 `chrome.storage.local` 的 `applyfill.jobVersions.v1`；临时岗位仍有六小时有效期，版本不会自动套用到其他页面。会话增加 `operation` 标识任务类型。

## 二、测试结果

| 检查 | 最终结果 |
|---|---|
| `pnpm test` | PASS，57 文件 / 520 用例，4.71 秒 |
| `pnpm typecheck` | PASS，扩展与 Testbed 两个 workspace |
| `pnpm lint` | PASS |
| `pnpm lint:boundaries` | PASS，8 个非法导入被拒绝，含别名与相对路径 |
| `pnpm --filter @applyfill/testbed build` | PASS |
| `pnpm test:e2e` | PASS，Chrome 全量 94 用例，4.2 分钟 |
| `APPLYFILL_E2E_BROWSER=edge pnpm test:e2e` | PASS，Edge 全量 94 用例，4.8 分钟 |
| Chrome / Edge 生产构建及 ZIP | PASS，两包各 13 个文件，逐文件与对应构建目录一致 |
| 源码冻结哈希与 `git diff --check` | PASS，262 个源码/测试文件未变化，文件集合一致；文档本地链接有效 |

安装包均为 **695,362 字节**，当前两包内容一致，SHA-256 均为 `901c347e2b94ca8511cddada1980122570ba8f622f5b82527667effbbbd5d79a`。ZIP 压缩完整性通过，Manifest V3，无 `.env`、`debugger` 或必选 `<all_urls>`；正式目标站点权限由用户手势授予。压缩包路径见第六节。

完整回归期间冻结 262 个源码及测试文件，结束后哈希及文件集合核对通过。验收采用最终同一份源码，不以中途的专项结果替代完整回归。最终单测和双浏览器完整回归均为零失败，无跳过用例。

本轮回归发现并修复了终态计数遗漏未映射字段、初始日期加载误算导航进展、上传失败仍显示完成，以及空任务持有者检查等问题。专项修复后重新执行完整回归，保留人工数量、文件保护和取消行为等实质断言；未增加重试或跳过用例。以上耗时是回归任务耗时，不是设计第 3 章的产品性能 KPI。

## 三、实际验证范围

本地测试使用真实 MV3 扩展、Service Worker、内容脚本、Workbench 和 SidePanel，运行 React/Vue 动态靶场。浏览器为 Linux x86_64 上的 Chrome for Testing 156.0.8078.4 和 Microsoft Edge 150.0.4078.48，Node v24.17.0，Playwright headless、单 worker。

核心控件与专项证据索引如下；完整用例结果以第二节为准，不将此表换算成独立准确率或覆盖率。

| 设计测试 | 当前自动化证据（`packages/testbed/e2e/`） |
|---|---|
| T01 / T04 / T13 原生文本、选择、日期 | `fill-native.spec.ts` |
| T02 / T03 React / Vue 受控输入 | `controlled.spec.ts`、`vue.spec.ts` |
| T05–T09 自定义/搜索选择、相似选项、Portal、预挂载 | `combobox.spec.ts`、`virtual.spec.ts` |
| T10 / T11 虚拟列表、异步候选 | `virtual.spec.ts` |
| T12 三级级联 | `cascader.spec.ts` |
| T14–T17 年月、日历、范围、无进展 | `beisen-month.spec.ts`、`datepicker.spec.ts`、`daterange.spec.ts`、`daterange-present.spec.ts`、`datepicker-stagnation.spec.ts` |
| T18–T20 扩容、多段经历、重绘身份 | `repeater-fill.spec.ts`、`vue-repeater.spec.ts`、`work.spec.ts`、`reanchor-remount.spec.ts`、`reanchor-delete-insert.spec.ts`、`section-scope.spec.ts` |
| T21 用户接管 | `user-protection.spec.ts`、`cancel.spec.ts`、`manual-transactions.spec.ts` |
| T22 SPA | `spa.spec.ts`、`spa-identity.spec.ts`、`final.spec.ts` |
| T23 跨域帧 | `frames.spec.ts`、`site-authorization.spec.ts` |
| T24 附件 | `upload.spec.ts` |
| T25 假成功、回滚、终态验证 | `validate.spec.ts`、`controlled.spec.ts`、`virtual.spec.ts` |
| RA 身份、WS 调度、WL 租约专项 | `reanchor-*.spec.ts`、`ambiguity.spec.ts`、`waves.spec.ts`、`cancel.spec.ts`、`manual-transactions.spec.ts`、日期专项，以及对应 identity / scheduler / guard / engine 单测 |
| 生命周期、存储与权限 | `lifecycle.spec.ts`、`persistence.spec.ts`、`context-persistence.spec.ts`、`message-authority.spec.ts`、`permissions.spec.ts` |
| 版本、模型隐私与主观题 | `resume-versions.spec.ts`、`resume-extensions.spec.ts`、`jd.spec.ts`、`llm-privacy.spec.ts`、`privacy.spec.ts` |

真实 ATS：本轮未执行，按用户安排交由用户本地测试；[真实 ATS 记录](ats-test-plan.md) 保留 0/15 的实际记录。模拟域名映射到 localhost 的权限测试不计入真实 ATS。独立人工标注 KPI、性能/Token 基准与远端 GitHub Actions 实际运行也未执行。

## 四、已知问题与限制

- 缺少可区分证据的经历、多个添加入口、跨独立原生表单的重复区块和嵌套争用会转人工；用户通过悬浮入口为具体字段选来源，或先手动添加空条目再重试。单字段确认不会自动授权整个争用区块。
- 完全没有 URL、标题、marker 等可区分信号的同构 SPA 步骤，无法普遍推断业务身份；超过有界预算的异步控件、缺少可验证提交证据的组件均按实际失败或人工处理报告。
- 日精度不足不会补造具体日；GPA 不自动换算量尺，数字输入约束不匹配时保持为空。PDF 扫描件暂不支持 OCR，规则解析结果必须先核对。
- 上传需要可访问的文件输入；网站接收未确认时转人工。无文件输入的专用拖拽组件及可选 CDP 上传未实现。
- 主观题为本地草稿，须用户审核应用；模型辅助目前用于字段路径路由。更多 ATS 专用适配器、更完善的主观题生成、智能版本选择和可信度校准属于 design.md 19.1 的后续增强范围。
- 已有取消、Worker 重启、存储拒绝、迟到回调等回归；浏览器原生 API 永久挂起、全部厂商组件和所有未知页面的故障组合未穷尽。SPA 步骤变化会拒绝旧结果写入，旧步骤模型 HTTP 请求仍可能持续到调用超时；取消整个 Run 会中止请求。
- 当前 SidePanel 的数量是本次任务记录，跨段误填等独立质量指标显示“未独立测量”；本地通过结果不构成未知网站零缺陷保证。

## 五、验收结论

**本地开发交付：PASS / READY_FOR_USER_TEST。** 源码重构、当前功能回归、生产构建与双浏览器安装包校验已完成，可以加载本地测试。

**完整设计的外部验证：PARTIAL。** 真实 ATS 和独立 KPI 尚无结果，不将 design.md 五大门禁整体标为 PASS。按用户安排由用户本地测试真实网站，反馈后继续修复；开发交付无需等待用户提供站点、账号或测试样本。

## 六、下一步依赖与本地使用

无需新增开发依赖或用户确认。源码、测试与文档纳入 Git 交付；安装包为本地构建产物，可通过 README 的打包命令重新生成。

1. 解压对应浏览器安装包：
   - [Chrome ZIP](../apps/extension/.output/applyfillextension-0.1.0-chrome.zip)
   - [Edge ZIP](../apps/extension/.output/applyfillextension-0.1.0-edge.zip)
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式，点击“加载已解压的扩展”，选择解压后包含 `manifest.json` 的文件夹。
3. 点击扩展打开 SidePanel，再点“打开工作台”。可载入示例并“导入并编译”，或导入自己的事实 JSON；PDF 先保存附件、解析并核对，再“确认导入”。编辑当前简历后重新导入会产生新版本。
4. 返回目标招聘页面，在 SidePanel 点击“授权此网站”，按需“注入内容脚本”，再“开始填写”。任务中可暂停、恢复或取消；未知或歧义字段使用悬浮入口手工确认来源。
5. 主观题可选择项目和切面生成草稿，编辑确认后应用。附件通过明确的上传操作执行，并在 SidePanel 查看网站确认结果。多步骤页面由用户切换下一步；最终投递始终由用户操作。

后续反馈可记录浏览器版本、页面步骤、字段标签及期望/实际结果；无需提供密码、API Key 或完整个人资料。
