# 隐私审计与扩展打包（W5-12）

对应 design.md 12.3（隐私运行模式）、12.4/12.5（缓存与记忆）与 W5-12 任务。审计对象为 `/apps/extension` 源码与真实构建产物。

## 运行模式结论

- 当前发布形态为 **Local-Only**：扩展源码中不存在任何网络出口 API（`fetch` / `XMLHttpRequest` / `sendBeacon` / `WebSocket` / `EventSource`），不存在云模型调用。
- Cloud-Assisted（主观题云端生成）未在本版本实现，因此不存在“未授权外发”的代码路径；`EssayGenerator` 为纯本地确定性生成。
- 网页内容（含 JD 描述、任意网页文本）只作为数据处理，不作为指令执行；不存在将网页文本注入模型或命令通道的路径。

## 数据清单与存储边界

| 数据 | 存储位置 | 键/库 | 生命周期 |
|---|---|---|---|
| 简历事实（可能含 PII） | IndexedDB | `applyfill` | 用户导入与清除，本地保留 |
| 附件原文件（PDF 等） | IndexedDB | `applyfill-files` | 用户导入与清除 |
| ATS 指纹缓存（结构特征，无字段值） | `chrome.storage.local` | `applyfill.fingerprintCache` | 持久，可清除 |
| 映射记忆（host/标签/控件类型→简历路径，无字段值） | `chrome.storage.local` | `applyfill.mappingMemory.v1` | 500 条上限 LRU |
| 字段修正记录（标签/类型/路径，无字段值） | `chrome.storage.local` | `applyfill.userCorrections.v1` | 200 条上限 |
| 运行会话状态 | `chrome.storage.session` | `applyfill.run.*` | 浏览器会话级 |
| 岗位上下文（JD 文本，临时） | `chrome.storage.session` | `applyfill.jdContext.v1` | 6 小时 TTL，按 host 存 |

补充说明：

- `chrome.storage.session` 通过 `background.ts` 的 `setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })` 开放给 content script，仅用于会话级临时数据；浏览器关闭即清。
- 映射记忆与修正记录只保存标签、控件类型与简历路径，不保存任何字段值（单测 `mappingMemory.test.ts` / `userCorrectionStore.test.ts` 校验）。
- 最终提交按钮永不由扩展点击（最终投递保护），不存在“误提交”数据外发路径。

## 自动化审计证据

1. 静态扫描（单测 `tests/unit/privacyBoundary.test.ts`）：递归扫描 `src/**/*.ts(x)`，匹配 `fetch(`、`new XMLHttpRequest`、`navigator.sendBeacon`、`new WebSocket`、`new EventSource`，要求命中数为 0。当前通过（304 用例全绿）。
2. 运行时网络捕获（e2e `privacy.spec.ts`）：在完整真实运行（导入简历 → 自动填写 react-native 页面 → VERIFIED）期间监听 Playwright context 的全部请求，断言不存在任何非 localhost 的 http(s) 请求。当前通过（e2e 38 用例全绿）。

## 构建与打包产物

- 构建：`pnpm --filter @applyfill/extension build`（WXT，输出 `.output/chrome-mv3`，总大小约 461 kB）。
- 打包：`pnpm --filter @applyfill/extension zip` → `.output/applyfillextension-0.1.0-chrome.zip`
- 产物证据（2026-10-16）：
  - 大小：149,657 字节（149.66 kB）
  - SHA-256：`fc86a39b0914a3631b283b1f03f3e6e03bbbdf7f7150c0fe8feca7322dca99c5`
  - 内容：`manifest.json`、`background.js`、`content-scripts/content.js`、`sidepanel.html`、`chunks/*`、`assets/*`，无多余调试文件。
- 校验方式：`unzip -l` 检查清单；`sha256sum` 留档。

## 已知边界与后续

- Cloud-Assisted 属于设计允许的扩展方向，若后续实现，须满足：授权可见可取消、仅发送任务所需最少资料、发送前本地审查剥离 PII；当前版本不涉及。
- 岗位上下文与运行会话存放于 session 存储，属于刻意选择（临时、不落盘）；如需跨会话保留 JD，应征得用户明确选择。
- 源码中无遥测、无崩溃上报、无第三方统计脚本。
