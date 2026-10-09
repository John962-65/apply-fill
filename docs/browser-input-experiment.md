# v0.8.0 浏览器输入试验版

## 使用

更新扩展，接受新增的 debugger 权限提示，刷新招聘页面。在填写助手勾选“实验：浏览器层点击与输入”，再使用原有填写按钮。开关默认关闭，不跨刷新保存；取消勾选恢复原操作通道。运行时保持招聘页面在前台，浏览器可能显示正在调试的提示。

本版接入自定义下拉的打开、选项点击、搜索输入，以及日期面板的打开、输入、翻页、日期格点击。资料树、字段匹配、来源校验、已有值保护沿用原实现；没有截图识别。错误来源不会因为换通道而自动变正确。

浏览器层操作失败时直接报告，不静默切回脚本点击。每次动作单独连接/释放调试通道，已有调试连接冲突会失败且不会主动断开别人的连接。当前只支持顶层网页，嵌套 frame 不执行，目标被遮挡、失去焦点或已替换时停止。

## Nanobrowser 调研与原型取舍

参考仓库：https://github.com/nanobrowser/nanobrowser

检查版本：24a14b76e14a9c30fd84878ca7985049d1e7d064。

其 chrome-extension/src/background/browser/page.ts 使用 Puppeteer 的 ExtensionTransport.connectTab，通过 CDP 连接当前标签；元素操作采用 Puppeteer 的 click/type，某些路径有页面脚本回退。

本版未复制或集成 Nanobrowser 的代码、规划器、反检测功能或整个依赖树，而是独立实现小范围浏览器输入通道，用来验证“输入机制”是否影响当前失败。页面观察与定位仍是 ApplyFill 的实现，不能称为完整 Nanobrowser 移植。

Chrome 官方文档明确 debugger 不能声明为 optional_permissions，所以权限在安装时声明，功能另设默认关闭的开关：https://developer.chrome.com/docs/extensions/reference/api/permissions

## 测试证据和限制

- 真实 Chromium + CDP 对照：只接受 isTrusted 事件的模拟控件拒绝脚本 click，接受 CDP click 和中文输入；连续填写能替换旧内容；遮挡目标与非法目标拒绝。
- 单元测试覆盖调试连接成功/失败后的释放和子框架拒绝。
- 原有表单与 16 个下拉浏览器场景回归通过。
- CDP 输入测试使用 Playwright 提供的调试连接；chrome.debugger 的消息与生命周期使用模拟 API 测试。尚未在桌面 Chrome 装载扩展后做端到端测试，也没有荣耀/京东/vivo 登录后实测。
- 本次没有进行完整 Nanobrowser 对照，也没有证明它能修复所有控件。需要在同样的空字段、同样的简历上对比开关前后的最终值。
