# 真实 ATS 测试计划与执行记录

任务编号：W5-11
任务名称：完成真实 ATS 测试（实战测试报告）
日期：2026-10-16
状态：**由用户本地测试 — 真实 ATS 填写验收尚无结果（2026-10-18）**

用户已明确安排“测试由我本地测试，你先把项目完成，后续我进行测试再反馈修复”。开发交付按此执行，不等待用户提供站点、账号或测试样本。源码、安装包与最新本地证据见 [本地开发交付说明](local-handoff-2026-10-18.md)。本文继续如实保留真实站点的执行记录。

依据：`design.md` W5-11 任务表与「真实 ATS 测试计划」（第 3321 行起）。
明确约束：未取得测试权限或无法访问的真实站点必须如实记录，不得用静态截图代替成功验收（design.md 3323；17.2 禁止「无证据宣称 ATS 通过」）。

## 一、计划目标（design.md 3321-3329）

| ATS 系统 | 目标测试入口数 | 重点 | 实际执行 |
|---|---:|---|---|
| 北森 | 3 | Phoenix、年月、经历扩容 | 未执行（见下） |
| Moka | 3 | 自定义 Select、动态表单 | 未执行 |
| 飞书招聘 | 3 | UD 组件、受控输入 | 未执行 |
| Greenhouse | 2 | 标准字段、iframe | 未执行 |
| Workday | 2 | SPA、多步骤流程 | 未执行 |
| 其他企业自研系统 | 2 | 未知组件、人工接管 | 未执行 |
| **合计** | **15** | | **0 / 15** |

## 二、执行状态与原因（如实记录）

| ATS 系统 | 可访问性 | 原因 |
|---|---|---|
| 北森 | 未验证 | 尚无已记录的具体测试职位入口与填写验收结果 |
| Moka | 未验证 | 尚无已记录的具体测试职位入口与填写验收结果 |
| 飞书招聘 | 未验证 | 尚无已记录的具体测试职位入口与填写验收结果 |
| Greenhouse | 未验证 | 尚无已记录的具体测试职位入口与填写验收结果 |
| Workday | 未验证 | 尚无已记录的具体测试职位入口与填写验收结果 |
| 企业自研系统 | 未验证 | 尚无已记录的具体测试职位入口与填写验收结果 |

不能据此推断所有公开职位均不可访问。`site-authorization.spec.ts` 使用映射至 localhost 的 `mock-recruitment.test`，只证明权限、标签页绑定和注入链路，不计入真实 ATS 的 15 个入口。

未执行任何「以静态截图/录屏代替成功验收」的操作。

## 三、本地功能回归（不等同于真实 ATS 验收）

以下本地靶场用例覆盖上述重点能力；最新结果见 [本地开发交付说明](local-handoff-2026-10-18.md)，历史矩阵见 `docs/week5-regression-matrix.md` 与 `docs/week5-patch-regression.md`。

| ATS 重点能力 | 本地靶场用例（全部通过） |
|---|---|
| 北森 Phoenix / 年月组件 | `beisen-month.spec.ts`、`datepicker.spec.ts`、`react-final` 教育经历下的北森式年/月字段（`edu-N-grad-year-trigger`/`edu-N-grad-month-trigger`） |
| 经历扩容（教育/项目） | `repeater-fill.spec.ts`、`vue-repeater.spec.ts`、`virtual.spec.ts`、`final.spec.ts`（教育 1→2、项目 1→3 扩容 + 逐条落位） |
| 自定义 Select / 动态表单 | `combobox.spec.ts`、`cascader.spec.ts`、`waves.spec.ts`、`controlled.spec.ts` |
| UD 组件 / 受控输入重渲染 | `controlled.spec.ts`、`vue.spec.ts`、`memory.spec.ts` |
| iframe | `frames.spec.ts`（同源子帧 COMPLETED；srcdoc 如实 UNREACHABLE） |
| SPA 多步骤 | `spa.spec.ts`、`final.spec.ts`（5 步 SPA，步进指纹与终态断言） |
| 未知组件与人工接管 | `ambiguity.spec.ts`、`pill.spec.ts`、`user-protection.spec.ts`、`jd.spec.ts` |
| 终止态与取消 | `validate.spec.ts`、`datepicker-stagnation.spec.ts`、`cancel.spec.ts` |
| 附件上传 | `upload.spec.ts`（SITE_CONFIRMED / REJECTED 双分支） |

## 四、用户本地测试记录指引

1. 准备：按 [本地开发交付说明](local-handoff-2026-10-18.md) 解压并加载对应浏览器安装包，每个入口准备一份结构化简历；**只填写、不执行最终投递**。
2. 记录：每个入口保存 RunSummary（`GET_STATE` 终态）、SidePanel 截图、必要的 Playwright trace；对 NEEDS_MANUAL 字段记录是否经 QuickFillPill 人工接管后完成。
3. 分开记录四类指标：映射准确率 = 正确映射字段 / 独立人工标注字段；提交成功率 = 确认提交字段 / 尝试执行字段；自动填写覆盖率 = 正确自动完成字段 / 符合条件且有数据的字段；整页成功率 = 全部范围内必填字段均正确自动完成的页面 / 符合条件的页面。最后一项目标 ≥90%，不能用字段比例替代。任何自动最终提交记为 FAIL。
4. 允许的如实结论：同一入口两次运行结果不一致、跨域 iframe UNREACHABLE、自定义拖拽上传 NO_FILE_INPUT 等均按实际记录，不修补为成功。

## 五、结论

真实 ATS 仍为 **0/15，未验证**。由用户本地测试并反馈问题，后续据实际结果更新记录和修复；本地开发交付无需等待此项。本地靶场回归不证明真实 ATS 整页完成率。
