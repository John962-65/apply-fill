# 真实 ATS 测试计划与执行记录

任务编号：W5-11
任务名称：完成真实 ATS 测试（实战测试报告）
日期：2026-10-16
状态：**BLOCKED（外部依赖）— 未执行，如实记录**

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
| 北森 | 不可访问 | 无企业侧发布的公开招聘表单沙箱与测试账号；生产表单需真实投递流程，违反「不执行真实最终投递」约束 |
| Moka | 不可访问 | 同上；无 sandbox 环境与授权 |
| 飞书招聘 | 不可访问 | 需要租户与企业管理员开通测试职位入口 |
| Greenhouse | 不可访问 | 官方 demo 职位页长期关闭投递；无测试租户 |
| Workday | 不可访问 | 仅有客户租户入口，无公开 sandbox；多步骤向导需真实账号 |
| 企业自研系统 | 不可访问 | 无获授权样本站点 |

未执行任何「以静态截图/录屏代替成功验收」的操作。

## 三、本地等价回归（替代证据，不等同于真实 ATS 验收）

在取得真实站点权限前，以下已通过的本地靶场用例覆盖上述重点能力；测试结果见 `docs/week5-regression-matrix.md` 与 `docs/week5-patch-regression.md`。

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

## 四、取得权限后的执行指引

1. 准备：加载 `apps/extension/.output/applyfillextension-0.1.0-chrome.zip`（见 `docs/privacy-audit.md` 打包证据），每个入口准备一份结构化简历；**只填写、不执行最终投递**。
2. 记录：每个入口保存 RunSummary（`GET_STATE` 终态）、SidePanel 截图、必要的 Playwright trace；对 NEEDS_MANUAL 字段记录是否经 QuickFillPill 人工接管后完成。
3. 判定口径（与 design.md 159 行 KPI 对齐）：整页自动完成率 = `VERIFIED / 可执行字段数`（排除 NO_DATA/无可填组件），目标 ≥90%；任何自动最终提交记为 FAIL。
4. 允许的如实结论：同一入口两次运行结果不一致、跨域 iframe UNREACHABLE、自定义拖拽上传 NO_FILE_INPUT 等均按实际记录，不修补为成功。

## 五、结论

W5-11 **未完成（BLOCKED）**。本地等价回归已全部通过（见第三节映射），但真实 ATS 整页完成率无实机证据，**不宣称通过**。待获得任一站点合法测试入口后可按第四节在 0.5 人日内完成单站点首轮记录。
