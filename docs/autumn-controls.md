# v0.8.6：秋招简历控件收集与集成

基于 v0.8.5 继续修改，保留已有资料树、补充信息归档、来源校验、ATSX/Phoenix 操作及桌面连接。收集日期：2026-10-02。

## 可以直接使用的变化

- 现代 Ant 日历、Element UI、iView 的单个年/月/日面板：打开当前控件关联的弹层，选择年份、月份、最终日期，必要时点击当前日历的确定按钮，关闭后读回核对。
- iView 下拉、React Select：识别控件外层与真实选中状态；搜索输入文字不能作为选中证明。Element UI 2 下拉从只读显示输入框核对选中值。
- 历史快照或内置种子的选项不会替代当前页面的观察。虚拟列表或远程搜索只展示部分选项时，AI 可以提交有简历来源的目标，实际驱动仍须在当前弹层找到唯一真实选项并点击。
- 新增北森表单标题、Phoenix 表单标签、iView 标签路径；帮助文字不能当字段名。日期外层已经识别后，内部通用 picker 节点不会覆盖它的归属和开始/结束标签。
- 扫描、操作、控件结构采集共用 `control-catalog.js`；JSON 导出附带组件编号、依据类型、版本，便于继续修复公司改造过的控件。
- 禁用日期、重复候选、多个无法区分的日期表、另一端被改动、选中后清空，都停止并报告。资料来源和重复经历的校验继续生效。

## 公开网站与脚本证据

| 平台或站点 | 已取得的证据 | 这次能确认什么 |
| --- | --- | --- |
| [vivo 校园招聘表单入口](https://hr-campus.vivo.com/form?fromPage=editMyResume) | 未登录入口 HTML、公开 Webpack 入口与 Phoenix 分包 | 页面公开加载北森代码；Phoenix 分包含 select、single-select-list、date-picker、calendar 实现。未取得登录后的候选人表单 DOM |
| [中信建投校招门户](https://csc108.zhiye.com/campus/jobs) | 公开 HTML 与脚本来源 | 该入口使用北森公开门户资源；职位列表不等于简历表单 |
| [小鹏飞书校招](https://xiaopeng.jobs.feishu.cn/campus/) | 公开搜索可见的招聘入口；本次 HTTP 读取未成功 | 招聘入口样本；未据此生成控件选择器 |
| [华泰证券 Hotjob 招聘](https://wecruit.hotjob.cn/SU6013d14e5d83dc11e4a8ae4d/pb/index.html) | 公开搜索可见的招聘入口；本次 HTTP 读取未成功 | Hotjob 平台样本；不强制按北森或某一版 Ant 操作 |
| Moka、sd-Select、部分大易表单 | 三个公开简历插件的源码/适配记录 | 只作为结构线索；没有充分证据的类名不升级成自动点击驱动 |

vivo 公开分包的具体 URL、SHA-256 和收集范围见 [机器可读证据](public-control-evidence.json)。代码留在研究临时目录，不复制第三方整份 bundle 到扩展，也不读取候选人的私人资料。

## 控件规则及验证范围

| 控件家族 | 来源 | 集成动作 | 已完成验证 |
| --- | --- | --- | --- |
| Phoenix | 北森发布的 3.3.55 包和 vivo 公开分包 | 保留下拉、搜索、年月/日期操作；共享根节点、弹层与标签规则 | 原有 10 种匿名状态测试及完整填写流程；公开分包核对；未验证登录后的 vivo 表单 |
| ATSX | 现有飞书适配及用户此前结构线索 | 保留期间、年份和旧日历驱动；共享识别与导出 | 7 种实际形状重建的回归场景 |
| 现代 Ant 日历 | `rc-picker@4.11.3`，以 `ant-picker` 前缀渲染 | 年份范围→年份→月份→最终日期 | **实际发布组件**，年/月/日各一例，生产 CDP 点击与 `onChange` 提交值核对 |
| Element UI | `element-ui@2.15.14` | 下拉显示值读取；年/月/日导航与禁用状态 | **实际发布组件**，3 类日期、语言下拉、禁用年份；开始/结束日期与另一端核对 |
| iView / View UI | `view-design@4.7.0` | 下拉、独立 transfer 弹层、年/月/日导航及确定按钮 | **实际发布组件**，3 类日期、需要确定的月份选择和语言下拉 |
| React Select | `react-select@5.10.2` | 外层 control 与 ARIA 弹层归属；从 singleValue 核对选择 | **实际发布组件**，语言选择和已有学历保护 |
| Ant 下拉与旧日历 | 原有适配 | 整理进共享规则，保留旧行为 | 原有异步搜索、联动、重渲染、重复候选、拒收等回归 |
| Moka、sd-Select | 开源项目中报告的结构 | `capture-only`：识别及采集，保留通用 ARIA 兜底 | 未宣称已验证私有表单；没有新增猜测性的菜单点击规则 |

**单个日历面板的兼容不等于双面板区间组件的兼容。** 新驱动无法唯一确定当前日期表时会停止。原有 ATSX 期间组件继续走其专用驱动，Phoenix 成对字段继续检查另一端。

新驱动支持日期精度，不负责选择时分；遇到时间面板会停止。确定按钮按对应组件的公开选择器操作，只限当前日历弹层。

在实际 `rc-picker` 测试中发现：切换年份或月份会把临时预览写到输入框，可能恰好等于目标日期，但 `onChange` 尚未提交。现在必须点击目标精度的最终日期格，再确认关闭后值仍保留；测试同时检查页面值和组件提交值，避免把预览当成成功。

## 一手组件来源

以下仅用于核对 DOM 和交互契约，未添加为扩展运行时依赖：

- [@beisen-phoenix/select 3.3.55](https://www.npmjs.com/package/@beisen-phoenix/select/v/3.3.55)、[single-select-list](https://www.npmjs.com/package/@beisen-phoenix/single-select-list/v/3.3.55)、[date-picker](https://www.npmjs.com/package/@beisen-phoenix/date-picker/v/3.3.55)、[rc-calendar](https://www.npmjs.com/package/@beisen-phoenix/rc-calendar/v/3.3.55)、[form](https://www.npmjs.com/package/@beisen-phoenix/form/v/3.3.55)。标签核对 `lib/component/FormItem.js`；选择、禁用、月/日格规则见各包发布代码。
- [rc-picker 4.11.3](https://www.npmjs.com/package/rc-picker/v/4.11.3)：`lib/PickerPanel/{DatePanel,MonthPanel,YearPanel,PanelHeader,PanelBody}`。年份范围按钮为 `super-prev/next`，非月份按钮。
- [Element UI 2.15.14](https://www.npmjs.com/package/element-ui/v/2.15.14)：`packages/date-picker/src/panel/date.vue`、`basic/{year-table,month-table,date-table}.vue`，以及 Select 发布实现。
- [View UI 4.7.0](https://www.npmjs.com/package/view-design/v/4.7.0)：`src/components/select`、`date-picker/panel/Date` 和 `date-picker/base`。注意该版本 Option 插槽要求 `i-option` 或 `Option` 名称。
- [React Select 5.10.2](https://www.npmjs.com/package/react-select/v/5.10.2)：发布代码中的 combobox 输入、listbox ARIA 关系、control 和 singleValue。

开源线索（独立实现规则，没有复制其整套填写代码）：

- [ResumeFiller](https://github.com/JuanHoi1996/ResumeFiller/tree/20e5e335bdd33bd2577aea87a603ce87af870d17)，`content.js` 与测试记录：北森布局、sd-Select 等。
- [resume-bridge](https://github.com/cloud-oc/resume-bridge/tree/a904fa9b070de7c07ec7f5026cab0e6d8dfbb3b0)，`src/core/engine/atsProfiles.ts`：平台和布局线索。没有采用其中过宽或无效的框架检测选择器。
- [resume-autofill-cn](https://github.com/QWE38qwe/resume-autofill-cn/tree/49addc2c41d7b7aa6ab1fd5ecf1e49460dce8332)，通用填写方案及平台报告。没有采用移除 readonly 后强写 value 的做法。

## 安装与使用

将 v0.8.6 解压并覆盖原扩展目录，在 `chrome://extensions` 重新加载 ApplyFill，再刷新招聘页面。保持原目录加载方式，以继续使用原有插件资料。

打开插件，勾选「实验：浏览器层点击与输入」，保持招聘页在前台，再填写。公司定制控件仍失败时，使用已有的「控件结构采集」→「自动点击采集」→导出 JSON；新版会附带控件家族及证据类型。

## 重复验证

```sh
npm test
npm run test:phoenix
npm run test:phoenix-fill
npm run test:atsx-dates
npm run test:forms
npm run test:combos
npm run test:input
npm run test:capture
npm run test:autoclick
npm run test:ui

# 独立测试依赖，不进入扩展；版本固定在测试目录。
npm install --prefix tests/published-controls
npm run test:controls
```

真实组件测试要求 Playwright 的 Chromium，或设置 `CHROMIUM_EXECUTABLE_PATH`。测试会临时打包公开组件，使用匿名资料及生产 CDP 通道点击。覆盖 9 个基本日期、1 个需要确定的月份选择、3 类下拉、保留已有值、禁用日期及多个无法区分的日历视图。完整填写测试额外放入不完整的旧选项快照，确认本次观察覆盖旧列表。
