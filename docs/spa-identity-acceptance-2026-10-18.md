# SPA 步骤身份、执行撤销与恢复验收

> 第六轮历史快照：当前验证、问题状态和安装包见 [本地开发交付说明](local-handoff-2026-10-18.md)，后续区块修复见 [区块绑定与来源选择验收](section-binding-acceptance-2026-10-18.md)。本文测试数字和包哈希对应第六轮构建，安装包已由后续构建替换。

任务编号：W4-08、W4-10、W5-04/10 及第 6.5、11.4 节的相关缺口。
任务名称：继续按 `design.md` 修复同构 SPA 步骤串用字段身份、保护状态及旧异步动作的问题。
日期：2026-10-18。

承接 [生命周期与上下文验收](lifecycle-context-acceptance-2026-10-18.md)。整项目结论仍为 **PARTIAL**；本报告只记录当前证据，不代替完整设计的剩余要求。

## 一、实现内容

| 修改文件 / 新增模块 | 当前行为 |
|---|---|
| `runtime/StepObserver.ts` | 将逻辑步骤身份与字段集合的发现指纹分开；步骤综合 URL pathname/search/hash、可见表单标识、页面/表单标题、活动步骤标记；查询参数、标题内容和活动 marker 变化均可识别同构步骤 |
| `StepObserver.ts` 生命周期 | 不再覆写网页的 history 方法；使用 DOM 属性/文本/子树监听、hash/popstate、后台 webNavigation 通知及动作前实时读取；新增 subscribe/refresh/stepId/stop；稳定等待有超时与取消支持 |
| `StepObserver.ts` 身份边界 | 相同步骤重绘和条件字段新增不改变 stepId；输入值、选项、扩展 UI 和常见浮层不参与逻辑步骤身份；显式容器步骤标记只读取属性，避免整个表单正文或候选项引起步骤误判；返回相同语义步骤时恢复原 stepId；报告指纹为不透明散列 |
| `runtime/ContentRuntime.ts` | 所有规划、重新扫描、人工动作、字段恢复都传入当前 stepId；旧元素缓存和动作入口检查步骤；经历实例注册表按步骤隔离；区块只有一个输入框时也能从控件自身找到实例角色 |
| `ContentRuntime.ts` 执行撤销 | 步骤变化立即撤销旧 Run 租约，并中止当前步骤的执行信号；整页 Run 可继续发现新步骤；单字段/上传任务在步骤改变时结束；旧组合框等待、模型路径回调和旧 Pill 不再作用于新步骤 |
| `ContentRuntime.ts` 恢复循环 | 每轮在等待表单稳定后比较步骤，避免切换发生在等待期间而漏记；终态 DirtyChecker/RecoveryPlanner 也在步骤信号内运行，若补填触发切换则再次规划；步骤返回时重新处理该步骤，保留其用户保护状态 |
| `ContentRuntime.ts` 报告 | 同一字段键只保留最新结果，扫描数按已观察字段键去重；同 Run 复扫保留本轮新建实例的来源状态，下次 Run 再报告匹配；旧步骤字段不加入当前页人工浮层和终态补填；步骤/发现/稳定等待到上限时报告 STEP_* 错误并终止，不能将未处理的新页标作成功 |
| `runtime/FieldBinding.ts` | 实际动作前增加 formId/stepId 核验；同一 DOM 节点即使 name、标签、类型相同，也不能使用旧步骤签名继续执行 |
| `scheduler/WaveBarrier.ts`、`WaveScheduler.ts` | 屏障接受运行时字段键解析器，与实际步骤/表单命名空间一致；步骤中止后的 DOM 差异不登记为跨步骤字段依赖 |
| `background/BackgroundRuntime.ts`、协议 | webNavigation 的 history/hash 变化向对应 Frame/documentId 发送 FRAME_NAVIGATED；不将 SPA history 变化等同于整个 Run 取消 |
| `background/TabCoordinator.ts` | 保留失败帧的具体 error 并汇总到 RunSummary；步骤上限可通过真实 RPC 与侧栏通知明确报告 |
| shared 契约、`FieldExecutionEngine.ts` | 字段结果可带 stepId/sectionType/instanceId；实例报告和步骤转换可带 stepId，避免不同步骤的同名实例在报告中覆盖 |
| 新增 `react-spa-same.html`、`src/pages/reactSpaSame`、`spa-identity.spec.ts` | 在复用同一 DOM、name 和标签的 React 场景中验证标题、查询参数、marker、回退、重绘、条件字段、跨步骤经历、迟到选项、补填切换及连续步骤上限 |

接口变化：

- `StepObserver` 新增逻辑 stepId、变更订阅、显式刷新、稳定等待和清理接口；指纹不再暴露原始 URL/标题字符串。
- `isFieldBindingValid` 接受当前步骤；`WaveBarrier` 可注入实际字段键解析函数。
- 新增 `FRAME_NAVIGATED` 内容脚本消息；字段、实例和步骤报告增加可选的步骤追踪字段，旧报告仍可读取。
- 所有状态仍在当前文档内使用，不持久化 DOM、活动许可或未完成动作；没有自动点击「下一步」或「最终提交」。

## 二、测试结果

| 检查 | 当前结果 |
|---|---|
| `pnpm test` | PASS，53 文件 / 464 用例 |
| `pnpm typecheck` | PASS，两个 workspace |
| `pnpm lint`、`pnpm lint:boundaries` | PASS，8 个非法导入被拒绝 |
| 最新 SPA / Repeater / Vue / 工作经历专项 | PASS，14 用例 |
| Chrome 全量 | PASS，78 用例，3.6 分钟 |
| Edge 全量 | PASS，78 用例，4.2 分钟 |
| Testbed 生产构建 | PASS |
| Chrome / Edge ZIP | PASS，压缩完整性、Manifest V3、权限清单及各包 13 个文件均逐字节匹配对应构建目录 |

安装包位于 `apps/extension/.output/applyfillextension-0.1.0-chrome.zip` 与 `apps/extension/.output/applyfillextension-0.1.0-edge.zip`。当前配置下两包相同，均为 **687,180 字节**；SHA-256：`16cfab152730be0f815b1f0c0f1a578ce6426e7b4d8f01a752dcc44d0fa0435c`。包内没有 `.env`；Manifest 未声明 debugger 或必选 `<all_urls>`，生产站点通过可选主机授权使用。

新增单测覆盖同构标题/表单/活动 marker、查询参数、返回原步骤、条件字段、重绘、值与选项变化、扩展 UI/浮层排除、文本/属性监听和 stop、无 form 的 h2、稳定等待与取消/超时、旧 stepId 动作守卫、运行时屏障字段键。

新增八项 `spa-identity.spec.ts` 浏览器回归：

1. 标题改变的两个同构步骤都正确填写，真实复用同一个 input 节点，字段键不同。
2. 只有 query 改变时仍正确切换，证明没有依赖网页 history 方法覆写。
3. URL/标题不变、只有活动步骤 marker 改变时正确切换。
4. 重绘与新增条件字段保持原身份和用户保护；新步骤可独立填写；返回原步骤仍保护用户输入。
5. 不同步骤中的同类教育经历分别建立绑定，实例报告保留两个步骤的记录。
6. 旧组合框延迟选项在换步骤后出现，旧动作不会点击它。
7. DirtyChecker 终态补填触发步骤改变时重新发现新步骤，旧字段结果不覆盖新步骤。
8. 连续自动换页达到上限后停止，RunSummary 为 FAILED 并保留 STEP_TRANSITION_LIMIT，新步骤保持空值。

回归确实发现三类实现缺口：五步流程起初漏记等待期间的切换、单控件容器不能找到自身实例角色，以及完整 Chrome 回归中同 Run 复扫把新实例状态误写为 MATCHED。第三项首次全量为 77 通过 / 1 失败，字段值均正确，失败发生在新建实例报告断言；实现已修复并重新验证。保留原保护断言，没有跳过用例、增加重试或用截图代替实际填写结果。

## 三、实际验证范围

单测覆盖真实业务模块与 DOM 环境；浏览器测试使用真实扩展 Worker、Content Script、webNavigation、DOM 事件与本地 React/Vue 靶场。新测试直接检查字段值、同节点复用、字段键、实例绑定、旧选项未被点击、用户输入保留和步骤上限后的空值。

未运行真实 ATS 15 入口、独立标注准确率/覆盖率、性能与 Token KPI、远端 GitHub Actions。回归任务耗时不作为性能 KPI。

## 四、已知问题与当前限制

- 页面完全没有可区分的路由、标题、表单身份或步骤标记时，不能仅凭相同控件结构证明它是新步骤；无标记重建、原地复用和复杂生产 SPA 仍需进一步验证，不能宣称所有 SPA 已覆盖。
- 当前步骤比较依赖可见语义元数据；动态标题与框架生成的表单标识、复杂未声明浮层可能需要额外适配。普通重绘、条件字段、常见浮层已有规定测试证据，不构成任意组件保证。
- 步骤等待为有界的 400ms 变化窗口、120ms 静稳窗口与 2s 稳定等待；动作后的长延迟跨页和生产站点更长异步过程仍需补齐。
- 同一步骤内多个同类 Section 的隔离、无显式实例的集合路径选择及动态新增实例重新绑定仍需继续完善；本轮解决的是不同步骤的实例命名空间。
- 原生存储永久挂起、所有 Background 调用方权限矩阵、JD 对子帧的明确继承仍需补齐。
- 步骤改变会中止本地模型等待和旧结果应用；同一个 Run 的后台 HTTP 请求目前没有单独的按步骤取消接口，仍由模型超时或整个 Run 的取消结束，旧结果不会应用到新步骤。
- Date 初次异步装载、浮层根替换、范围首日延迟联动、多选 Select、生产供应商提交证据、简历/岗位版本、GPA/奖项和完整切面审核仍未全部完成。
- 字段/实例报告已补充步骤追踪信息；SidePanel 的完整多步骤审查、附件逐字段报告及独立统计仍需完善，固定展示值不能充当 KPI 证据。
- 59 项任务、25 类控件、RA/WS/WL、五大 Gate、真实 ATS、独立 KPI 与远端 CI 尚未全部取得当前证据。

## 五、验收结论

**PARTIAL**。同构步骤身份、旧步骤撤销、用户保护隔离和有界恢复取得实现与规定回归证据；整项目仍有下列未完成工作。

## 六、下一步依赖

继续处理同一步骤内多个同类 Section、无绑定集合字段的来源选择、Date 剩余异步分支及版本/切面审核产品流程；原生平台故障和所有调用方权限继续审查。本地工作可以继续执行。

真实 ATS 验收需要可使用的具体页面及授权测试资料；独立 KPI 需要标注样本与单独计量，不以这些外部条件缺失为由停止本地重构。
