# v0.8.5：凤凰控件识别、操作和来源校验

v0.8.4 的诊断中，`phoenix-select__input--unText` 被记成 `input:text`，日期和语言写入后仍为空；部分项目、校园描述没有通过来源校验。此修复在 v0.8.4 的资料树与用户提供的 v0.8.3 衍生代码上继续修改。

## 控件修复

- 识别 `.phoenix-select` 和已有的 `.phoenix-select__cont`，将内部 input 归入一个自定义控件。
- 从 `.phoenix-select__tipEle` 读取选中状态；不把输入框搜索词、占位层、用于测量宽度的 `calcEle` 计为填写成功。
- 支持独立的 UnmodeledLayer 弹层和 `.phoenix-single-select-list__item`；只操作 ARIA 明确关联或当前控件打开后唯一出现的面板，不搜索全页文字。
- 在当前面板内寻找搜索框。`--unText` 表示不可搜索的触发器，不能往里面写搜索词；面板内的搜索框不再参与简历字段扫描。
- 凤凰 RC Calendar 按实际年份/月导航按钮和日期格操作，支持年月及年月日面板。这份组件实现没有 `td.title`，按明确年月和相邻月份状态类区分日期格。
- 重复记录中各有一个明确开始和结束字段时建立日期对，核对来源记录和顺序，选择日期时检查另一端是否被改变。不能根据未知字段的网页顺序猜开始/结束。
- 浏览器层点击前等待滚动和目标位置稳定，重新检查节点、命中点及遮挡。
- 加深有边界的标签查找；未知下拉仍保留在扫描及控件采集入口，避免内部 input 已排除、整个控件也消失。未识别字段仍需实际 DOM 采集确认。
- 控件采集支持凤凰根节点和弹层；后续可用「自动点击采集」打开失败控件并导出结构。

## 描述来源

AI 可以用 `sourceIds` 引用同一条记录的多个描述字段；每个来源编号必须真实、唯一且实际贡献内容。逐句核对原文，拒绝跨记录拼贴、未知编号和新增事实。旧回复只给一个描述来源时，可以在该明确记录的描述字段内回查组合原句。模型提示改为优先原文，减少无法验证的自由改写。

项目名称、职务名称和获奖项等字段可以建立记录锚点；日期、描述必须与该记录一致。同月不同日期写法也保留多来源歧义。不存在的联系方式、无法证明的学历仍不自动生成。

## 使用

覆盖原扩展文件夹后，在扩展管理页重新加载，再刷新招聘页面。打开插件并勾选「实验：浏览器层点击与输入」，保持招聘页面在前台，然后运行填写。

如果仍有未识别控件，使用「控件结构采集」中的「自动点击采集」，结束后导出 JSON。无需写脚本或打开开发者工具。

## 依据与验证边界

本次核对的第一方发布代码均为 3.3.55，未作为新的运行时依赖安装进插件：

- [@beisen-phoenix/select](https://www.npmjs.com/package/@beisen-phoenix/select)：`src/components/Select.tsx` 中的根节点、输入层和 `renderTxt`。
- [@beisen-phoenix/single-select-list](https://www.npmjs.com/package/@beisen-phoenix/single-select-list)：`ListItem` 和 `SelectList` 中的候选节点、禁用状态。
- [@beisen-phoenix/unmodeled-layer](https://www.npmjs.com/package/@beisen-phoenix/unmodeled-layer)：独立弹层内容节点。
- [@beisen-phoenix/date-picker](https://www.npmjs.com/package/@beisen-phoenix/date-picker) 和 [@beisen-phoenix/rc-calendar](https://www.npmjs.com/package/@beisen-phoenix/rc-calendar)：年月面板、头部按钮、月份及日期单元格。

测试使用匿名资料和公开 DOM 合约重建的状态机，控件要求 `isTrusted` 事件，点击通过生产 CDP 通道执行。覆盖正常选择、面板内搜索、节点重建、重复候选、拒收、延迟清空、写错端点、两端一起被修改、无效翻页，以及无 title 的日期格；另有填写按钮至 worker 来源校验、四个日期端点及最终页面读回的完整流程。

这些测试不等于原招聘站已登录页面的验证。当前只有用户诊断日志，没有该页面实际 DOM JSON；站点改造过的复合日期、虚拟列表或其他弹层仍可能需要针对采集结构补适配。

```sh
npm test
npm run test:phoenix
npm run test:phoenix-fill
npm run test:forms
npm run test:combos
npm run test:atsx-dates
npm run test:input
npm run test:capture
```
