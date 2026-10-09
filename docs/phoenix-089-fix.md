# v0.8.9：凤凰下拉与经历归属

本次继续基于 v0.8.8 修改。用户日志中的出生日期、教育与项目起止时间、同名奖项的各年获奖时间已经写入并读回。本次针对残余的学历、语言下拉、校园任职漏匹配和项目描述来源问题。

## 证据与改动

| 日志现象 | 已确认的代码缺口 | 修复 |
| --- | --- | --- |
| 下拉打开后读到 0 个选项 | 北森同时发布 `single-select-list` 和 `select-list`；旧规则只覆盖前者 | 注册 `.phoenix-selectList` 面板，并点击真正绑定回调的 `__singleLabel`；检查其父级 `__listItem--disabled` |
| 后续控件被遮挡 | 未识别的列表无法进入原来的关闭分支；React 弹层关闭还可能等待重渲染 | 关闭按异步流程等待；只有唯一关联的弹层仍在时才尝试切换原触发器；始终保留浏览器命中检查 |
| 多段经历里的下拉没有条目号 | 原先最多向上找 14 层，普通输入与深层下拉的距离不同 | 在 32 层内寻找重复结构；签名按板块和字段一起比较，避免跨板块合并 |
| 在校职务整段未提供值 | 板块白名单缺少此名称，且部分标题是普通样式化 div/span | 识别有限的精确标题别名，归为校园经历；排除导航、标签、输入值及弹层选项；资料树预设也支持同义名称 |
| 已有项目名称，描述仍被来源校验拦截 | AI 省略来源或改写后无法验证，而原本的硬事实规则不补描述 | 先保留来源拦截；只有网页这条记录的名称/职务已唯一指向简历记录，才取该记录的概述、主要工作原文作为新候选，再过同一来源校验 |
| 采集下拉值时丢失归属 | 采集代码只从 `entry.element` 取板块，组合框使用的是 `entry.root` | 沿用扫描时确认的板块与条目身份 |

依据来自第一方发布包 [select 3.3.55](https://www.npmjs.com/package/@beisen-phoenix/select/v/3.3.55)、[select-list 3.3.55](https://www.npmjs.com/package/@beisen-phoenix/select-list/v/3.3.55)、[single-select-list 3.3.55](https://www.npmjs.com/package/@beisen-phoenix/single-select-list/v/3.3.55) 和 [unmodeled-layer 3.3.55](https://www.npmjs.com/package/@beisen-phoenix/unmodeled-layer/v/3.3.55)。这些缺口与日志相符，但尚未取得本次登录后的公司页面 DOM，不能断言其所有控件都与公开版本一致。

## 验证

新增测试会实际加载固定版本的 `Select`、`SelectList`、`UnmodeledLayer` 和其样式，用生产 CDP 输入通道操作匿名表单。验证两条教育记录的学历、语言类型、掌握程度、父级禁用项、同名选项、保护已有值、20 层包装下的条目归属、样式化标题、弹层关闭及采集归属。它不是控件交互的重新实现。

```bash
npm install --prefix tests/published-phoenix
npm run test:phoenix-published
```

测试依赖仅在测试目录，不进入扩展；使用 Playwright Chromium 或 `CHROMIUM_EXECUTABLE_PATH`。其余命令沿用现有环境：

```bash
npm test
npm run test:phoenix
npm run test:phoenix-fill
npm run test:combos
npm run test:startup
npm run test:forms
npm run test:controls
npm run test:capture
npm run test:autoclick
```

完整填写测试通过扫描、后台匹配与来源校验、浏览器输入、最终 DOM 读回，覆盖两条校园任职、被拒绝描述替换为本条原文、四个项目日期端点、三个同名不同年份奖项和保持未选的“至今”。单元测试同时拒绝跨记录、跨分组、同段锚点冲突、同用途多个叙述和附件链接字段的误填。

## 使用与边界

将新版解压到原扩展目录，在扩展管理页点重新加载，刷新招聘表单后勾选“实验：浏览器层点击与输入”。无需重新导入简历。

本次不登录或提交招聘网站，也不增加截图驱动。控件能选择“本科”不等于资料已经证明本科学历；每条教育记录应明确保存自己的学历和学位。手机号、期望城市、薪资、校园任职时间、奖项级别等没有明确来源时仍留空。描述原文兜底不按网页条目序号猜简历记录；原文有多个同用途候选时也停止。
