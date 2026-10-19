# V2.1 重构审计与本轮验收记录

> 首轮实现与测试快照：最新源码、安装包、测试结果及使用说明见 [本地开发交付说明](local-handoff-2026-10-18.md)。下方第一、二节的测试数字与 ZIP 哈希记录首轮构建，安装包已由后续构建替换；第三、四节按当前开发收尾更新。此前各轮报告保留历史证据。

任务：依据 `design.md` 重构整个项目、修复缺陷。
日期：2026-10-18。
范围说明：本地开发按用户安排交付，真实招聘网站由用户本地测试并反馈修复。完整设计五大门禁仍有真实 ATS、独立 KPI 等未验证项目，不作全部 PASS 声明；当前开发交付状态以最新交付说明为准。

## 一、实现内容

| 对应要求 | 修复与重构 | 验证证据 |
|---|---|---|
| W4-06/07/10、9.10 | TabCoordinator 在异步发现帧前取得任务许可；同一 Tab 同时仅一个协调任务；所有帧共享 runId；取消后不再启动后续帧；超时主动取消原 documentId；暂停约束后续帧调度 | `tabCoordinator.test.ts`、`lifecycle.spec.ts` |
| W4-09、11.5 | SessionStore 串行化同 Tab 状态更新；拒绝旧 runId、已中断任务和错误 documentId 的迟到事件；子帧完成不提前结束整页任务；Worker 恢复先中断并取消存活的旧任务 | `sessionStore.test.ts`、浏览器真实停止 Worker 的 `lifecycle.spec.ts` |
| W1-07、PATCH-04 | 校验活动租约确实持有字段、版本一致；markVerified 自身执行有效性检查；到期定时撤销并发出 AbortSignal；验证后再次检查取消信号；旧事务返回不清理新事务的控制器 | `guardRegistry.test.ts`、`fieldExecutionEngine.test.ts` |
| W2-02、W4-10 | Repeater 扩容前、点击前、等待后检查取消信号；等待可立即取消；单次等待受剩余总预算限制；按钮或区块失效时停止 | `repeaterManager.test.ts` |
| W1-12、W5-04 | 填写期间可以使用暂停、恢复和取消；活动任务不能重复启动；报告中用户修改字段按 fieldKey 去重 | `lifecycle.spec.ts`、`sidepanel.spec.ts` |
| W4-11、13.1 | 附件采用 Base64 编码跨运行环境传递，解码检查大小；上传前取消不写 files 或派发事件；历史同名文件提示不作为本次成功证据 | `binary.test.ts`、`fileUploadAgent.test.ts`、`upload.spec.ts` 逐字节检查 |
| W2-01/03/08、6.3 | 工作经历纳入 Scoped 实例绑定、扩容与重锚定；按所属经历路由同名起止日期；支持原生 month 控件 | `work.spec.ts`：三段工作经历及重排、重绘、用户保护 |
| W1-06、6.5 | 每个文档拥有独立 formId，避免跨帧同名字段键冲突；字段键包含 groupLabel；规范化值编码以防分隔符串联碰撞 | `identity.test.ts`、跨帧与重绘 E2E |
| W1-04、5.3 | 项目生成 title、one_liner、summary_150、responsibilities、outcomes、full_description、keywords 和来源事实路径；未知成果保留为空；职责/成果/关键词可通过原始事实编辑后重新编译 | `resumeCompiler.test.ts`、原始事实 JSON 编辑 |
| W1-04、5.4 | 导入校验事实元数据、值类型、日期与重复经历 ID；自身导出的编译 JSON 可以重新导入；新增编辑当前简历；IndexedDB 写入等待事务完成 | `resumeValidation.test.ts`、`resumeStore.test.ts`、`resume-parse.spec.ts` |
| W2-09/12、12.1 | 修复 LLM 数组模板缺少方括号导致经历路径无法解析的问题；指针校验后能够读取第二段经历 | `llmRouting.test.ts`：校验 → 索引替换 → 本地解析 |
| W2-10、5.2、10.7 | 严格校验实际日期；保留中文日期精度；缺少日精度时拒绝向日历补造 1 号或月末；完整起止日期和至今流程继续支持 | `resumeCompiler.test.ts`、`formatter.test.ts`、`dateAgent.test.ts`、`daterange*.spec.ts` |
| W2-11、12.4 | 缓存升级为 schema 2，复核步骤、语义组、name、控件约束、组件特征和候选项；拒绝旧版/损坏数据；仅终态仍 VERIFIED 的新映射入缓存；失败命中失效；手动换来源清理旧缓存 | `routerCache.test.ts`、`plannerInstances.test.ts`、`memory.spec.ts` |
| W1-03、PATCH-03、18.1 | 修复 ESLint brace 目录匹配遗漏子文件；Runtime 通过共享 UI 契约和依赖注入调用悬浮组件；新增 8 个禁止导入探针；补齐 GitHub Actions 验证、构建及打包工作流 | `pnpm lint`、`pnpm lint:boundaries`、`.github/workflows/ci.yml` |

Chrome 扩展消息使用 JSON 序列化，不能直接传递 ArrayBuffer；详见 [Chrome messaging 官方文档](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#serialization)。此前附件测试只检查文件名，本轮增加真实浏览器中的内容与大小断言。

接口变化：`AttachmentInfo.bytes` 改为 `dataBase64`；帧执行与控制消息可携带 runId；ContentRuntime 构造函数要求注入 mountPill；UI 契约移入 shared/contracts/ui；FieldExecutionResult / MappingIssue 增加 frameId；FieldKey schema 升至 2，ATS 缓存 schema 升至 2。旧字段键属于旧文档内存状态，不恢复其租约；旧版缓存不自动信任。

原日期范围测试把仅年月数据补为月初/月末当作成功，与设计第 5.2 节冲突。有效填写用例改为提供确实存在的完整日期，另保留年月精度不足的拒绝用例，未删除失败保护断言。

## 二、测试结果

| 检查 | 当前结果 |
|---|---|
| `pnpm typecheck` | PASS，两个 workspace |
| `pnpm lint` | PASS |
| `pnpm lint:boundaries` | PASS，8 个非法导入均被拒绝，包括别名与相对路径 |
| `pnpm test` | PASS，44 文件 / 364 用例 |
| `pnpm test:e2e` | PASS，Chrome 全量 50 用例，约 2.2 分钟 |
| 最终 Chrome 构建关键链路复验 | PASS，cancel / lifecycle / fill-native / upload 共 8 用例，13.2 秒 |
| 最终 Edge 构建基础兼容复验 | PASS，controlled / fill-native / lifecycle / upload / vue 共 8 用例，14.6 秒 |
| Testbed 生产构建 | PASS，含新增 react-work 页面 |
| Chrome / Edge ZIP | PASS，压缩完整性、Manifest V3、权限清单与包内每个文件匹配构建输出 |
| `git diff --check` | PASS |

环境：Linux x86_64；Node v24.17.0；Chrome for Testing 156.0.8078.4；Microsoft Edge 150.0.4078.48；Playwright headless、单 worker。以上时长只记录回归任务耗时，不代替第 3 章的性能 KPI。

本轮曾遇到 Chrome 与 Edge 并行测试共用 outputDir 导致 trace 文件被另一进程清理的失败。已隔离为 `test-results/chrome` 与 `test-results/edge`，重新运行全量 Chrome 和最终双浏览器复验通过；未通过重试配置、删除断言或跳过用例掩盖失败。

安装包：

- `apps/extension/.output/applyfillextension-0.1.0-chrome.zip`
- `apps/extension/.output/applyfillextension-0.1.0-edge.zip`
- 两包在当前 MV3 配置下内容一致，均为 **670,084 字节**，SHA-256：`782af7389b491ec1c59eb779cd3bd8e272f1d76c068c600ce7783bf8951b3f8a`。
- ZIP 已逐文件比较其对应的可加载构建目录；未包含 `.env`，未声明 debugger 或必选 `<all_urls>` 权限。可解压后通过浏览器扩展开发者模式“加载已解压的扩展”安装。

未运行：真实 ATS 15 个入口填写验收、独立标注准确率与性能/Token 基准、远端 GitHub Actions 实际运行；因此当前不作整项目 PASS 声明。

## 三、当前实现追踪与验证边界

| 设计范围 | 当前证据与状态 | 尚未验证或后续增强 |
|---|---|---|
| 第 3 章准确率、覆盖率、性能与 Token KPI | **未验收**；目前为功能回归，不能换算成独立数据集准确率或真实页面成功率 | 独立人工标注字段集、符合条件的页面集；记录浏览器、硬件、样本数与 P50/P95；单独测量缓存 Token 节省 |
| 第 4、8 章四端与双包结构 | 四端、两个 workspace、单向依赖门禁与构建已具备 | 远端 GitHub Actions 实际运行未验证 |
| 第 5 章三层知识库与 Workbench | 事实来源、编辑、编译、导出、清除、简历/岗位命名版本、GPA/奖项/补充信息、项目切面选择与审核已补齐；旧编译数据迁移有回归 | 智能版本选择和更完善的主观题生成属于后续增强；PDF OCR 未支持 |
| 第 6 章身份与 PATCH-01 | RA 与多段教育/项目/工作、同构 SPA、返回步骤保护、步骤隔离、同类区块统一重锚定与扩容已有证据；独立原生表单和嵌套争用转人工，明确选来源只授权具体字段 | 无可区分标记的 SPA 无法普遍识别；独立业务子列表不猜测绑定，整区块人工绑定可后续增强 |
| 第 7 章调度与 PATCH-02 | 波次、联动、终态补填已有功能回归 | 运行时降级与任意文本依赖的完整故障注入；生产站点长异步加载的验证 |
| 第 9 章租约与 PATCH-04 | DOMRevision、动作前复核、真实进展续租、单字段/上传统一许可与取消；日期初始加载、根替换、范围延迟联动、加载中取消已补齐回归 | 生产站点超长异步组件和浏览器原生 API 永久挂起未穷尽 |
| 第 10 章提交、复杂控件、DirtyChecker | 本地原生、受控、搜索、级联、日期、虚拟列表及假成功用例覆盖 | 无 testbed 状态钩子的真实组件提交证据；所有供应商适配及多选 Select 的完整实际支持仍未证明 |
| 第 11 章 Frame / SPA / Worker | 跨域帧、真实停止 Worker、Frame 恢复、启动取消、迟到回调、SPA 中止/重规划、换页上限已有证据；权限移除主动取消，权限检查失败后原持有者仍可释放任务 | 原生存储挂起、极端导航及全部平台故障组合未穷尽；旧步骤模型 HTTP 可能运行至超时，旧结果不能写入 |
| 第 12 章隐私、路由和缓存 | 默认本地；双重清洗与临时别名；Run 取消模型；个人资料/歧义来源需确认；IndexedDB 增量缓存；历史 epoch；可信 local/session；所有后台 API 有调用方策略，文档及活动任务授权、私有读取后复核、事件形状验证已补齐 | 复杂语义和未知网页语料仍需独立审计；不作绝对隐私保证 |
| 第 13 章附件、JD、主观题、悬浮 UI、报告 | JD 精确页面绑定、显式选择对子帧继承与本地岗位版本；主观题项目/切面选择、编辑审核和事务写入；附件用户选文件保护、网站确认、失败状态与字段报告；未映射字段纳入人工数量，未测指标明确标注 | 无输入框的专用拖拽上传和 CDP 未实现；独立质量指标待测，更丰富执行可视化属后续增强 |
| 第 14–15 章 W1–W5、25 类控件、RA/WS/WL、故障注入 | 原有任务文件与矩阵存在；本轮回归扩展不能直接替代每条要求的证据 | 将所有任务和专项按当前实现逐条复验，不能沿用旧 PASS；本轮没有据此宣称 59 项任务全部完成 |
| 第 18 章源码、安装包、Edge、CI、工程文档 | 源码、双浏览器安装包及本地证据见最新交付说明 | 真实 ATS 由用户本地测试；独立 KPI 与远端 CI 未执行，不作为等待用户的开发阻塞 |

## 四、五大验收门禁

- Gate 1：本地功能回归通过范围内有证据；真实组件与完整供应商覆盖尚未全部证明。
- Gate 2：多段经历、保护、重绘、DOMRevision、同构步骤、返回步骤与跨步骤隔离、同类区块统一绑定有证据；独立原生表单和嵌套争用已覆盖人工兜底。无标记 SPA 与未知业务子列表无法普遍推断。
- Gate 3：整页、单字段、上传与模型调用取消有当前证据；全部生产组件与故障注入仍需逐项复验。
- Gate 4：Worker 重启、Frame session 恢复与树清理、启动等待取消和过期回调拒绝已有证据；原生存储挂起、极端导航及完整故障注入尚未齐备。
- Gate 5：主要产品流程、简历/岗位版本、主观题切面审核、上传报告和双包构建已具备本地回归；真实 ATS 与独立 KPI 未验证。

不得将上述门禁整体标为 PASS。按用户安排先交付本地开发成果，真实网站测试由用户执行，反馈后继续修复；未来增强能力不作为本次交付的前置依赖。
