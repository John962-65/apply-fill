# Week 5 核心 25 类控件回归矩阵

对应 design.md 15.2「核心 25 类控件测试」表。全部用例使用真实编译后的扩展（`pnpm test:e2e` 自动构建 `.output/chrome-mv3`）在真实浏览器中执行，不模拟 Content Script 环境。

- 运行方式：`pnpm test:e2e`（共 35 个用例，全部通过）
- 单测覆盖：`pnpm -C apps/extension test`（38 文件 / 299 用例）

## 回归矩阵

| ID | 测试场景 | Spec（用例） | 关键断言 | 状态 |
|---|---|---|---|---|
| T01 | 原生文本输入 | `fill-native.spec.ts` React 原生表单 | 姓名/手机/邮箱/简介等值正确写入 | 覆盖 |
| T02 | React 受控输入 | `controlled.spec.ts` React 受控组件 | 提交后经重新渲染仍然保持 | 覆盖 |
| T03 | Vue 受控输入 | `vue.spec.ts` Vue 受控组件 | v-model 正确同步且重渲染后保持 | 覆盖 |
| T04 | 原生 Select | `fill-native.spec.ts` | 学历原生 select 正确提交 | 覆盖 |
| T05 | 自定义 Select | `combobox.spec.ts` 搜索型组合框 | data-committed 正式回写为「清华大学」 | 覆盖 |
| T06 | 搜索型 Select | `combobox.spec.ts` 搜索型组合框 | 搜索过滤与正式提交分离（matchedText 精确） | 覆盖 |
| T07 | 相似候选项（精确消歧） | `beisen-month.spec.ts` 月份搜索"1"；`combobox.spec.ts` 专业 21 | 搜索"1"不得误选 10/11/12；"专业21"不得命中"专业2" | 覆盖 |
| T08 | Portal 浮层 | `combobox.spec.ts`、`datepicker.spec.ts`、`cascader.spec.ts`、`beisen-month.spec.ts` | createPortal 至 body 的浮层正确定位与关闭 | 覆盖 |
| T09 | 预挂载浮层 | `virtual.spec.ts` 预挂载浮层 | 初始 display:none 的浮层展开后可定位并提交，结束后恢复隐藏 | 覆盖 |
| T10 | 虚拟滚动列表 | `virtual.spec.ts` 虚拟滚动候选列表 | 滚动定位第 26 项（计算机科学与技术）并正式提交 | 覆盖 |
| T11 | 异步候选项 | `virtual.spec.ts` 异步候选项 | 加载中占位→延迟渲染后等待完成并提交（本科） | 覆盖 |
| T12 | 三级 Cascader | `cascader.spec.ts` | 逐列点击省/市/区，回写完整路径 | 覆盖 |
| T13 | 原生日期 | `fill-native.spec.ts`（出生日期 input[type=date]） | 日期值 1998-03-15 正确写入 | 覆盖 |
| T14 | 年月双下拉 | `beisen-month.spec.ts` | 年份列表精确选择 + 月份双字段正式提交 | 覆盖 |
| T15 | 年月日组件 | `datepicker.spec.ts` | 跨年代翻页后 2026-03-15 一致 | 覆盖 |
| T16 | 日期范围 | `daterange.spec.ts` | 双向面板分别翻页，起止取月末一致 | 覆盖 |
| T17 | 日期无进展（有限熔断） | `datepicker-stagnation.spec.ts` | 导航失效时不误标成功，有界点击后转人工（NEEDS_MANUAL），无失控点击 | 覆盖 |
| T18 | Repeater 扩容 | `repeater-fill.spec.ts`、`vue-repeater.spec.ts` | 实例数量按事实扩容且稳定重跑 | 覆盖 |
| T19 | 多段经历（不跨段） | `repeater-fill.spec.ts` | 三段教育三段项目不串写；`ambiguity.spec.ts` 同名不盲目绑定 | 覆盖 |
| T20 | DOM 重绘重锚定 | `reanchor-remount.spec.ts`、`reanchor-delete-insert.spec.ts` | 身份正确恢复；删除/插入索引不错位 | 覆盖 |
| T21 | 用户输入接管 | `user-protection.spec.ts`（2 用例） | Agent 不覆盖用户输入；执行期间接管即跳过 | 覆盖 |
| T22 | SPA 路由切换 | `spa.spec.ts` | 首步填写后自动重新发现并填写下一步 | 覆盖 |
| T23 | 跨域 iframe | `frames.spec.ts` | 主帧与子帧串行执行；不可注入帧如实报告 UNREACHABLE | 覆盖 |
| T24 | 文件上传 | `upload.spec.ts`（2 用例） | 程序化注入 PDF 并以网站状态确认为成功；严格组件判定失败转人工 | 覆盖 |
| T25 | 假成功与回滚 | `combobox.spec.ts` 可见文本无提交状态；`validate.spec.ts`；`upload.spec.ts` 严格组件 | 仅可见文本→UNKNOWN 而非成功；页面校验错误→降级人工；假成功被识破 | 覆盖 |

## 本轮新增/调整

- 新增页面 `react-virtual.html`（`reactVirtual/main.tsx`）：覆盖 T09 预挂载浮层（display 切换、非 portal）、T10 虚拟滚动（30 项、8 项窗口、ITEM_HEIGHT 28）、T11 异步候选项（250ms 延迟渲染，加载占位可滚动以等待完成）。
- `react-native.html` 新增「出生日期」`<input type="date">`（T13）；`FastRuleMatcher` 增加 `basic.birthDate` 规则（patterns：出生日期/出生年月/出生年月日，controlKinds: date）；`fill-native.spec.ts` 计数断言由 10 更新为 11。
- `react-datepicker` 支持 `?deadnav=1`：导航按钮保留点击计数但不推进视图，用于 T17 无进展熔断。
- 新增 `virtual.spec.ts`（3 用例）、`datepicker-stagnation.spec.ts`（1 用例）。

## 说明

- T17 熔断语义：Actuator（DateAgent/SelectAgent）以动作预算与 `maxScrollPasses`/`noProgress` 有界收尾；引擎在重试预算耗尽后落 `NEEDS_MANUAL`（如 `RETRIES_EXHAUSTED`），不产生无限点击。`CIRCUIT_BROKEN` 状态由契约/面板保留，RecoveryPlanner 的该分支由单测覆盖（`recoveryPlanner.test.ts`）。
- 与 15.3 三个专项套件（Suite A Reanchor Regression / Suite B Arbitrary Order Robustness / Suite C Runtime Consistency）的交叉部分见 `docs/week5-acceptance.md`（W5-10 汇总）。
