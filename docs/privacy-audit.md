# 隐私审计与扩展打包（W5-12）

对应 design.md 12.3（隐私运行模式）、12.4/12.5（缓存与记忆）与 W5-12 任务。审计对象为 `/apps/extension` 源码与真实构建产物。

2026-10-18 复核：本文以下旧测试数字和包哈希保留为历史记录，最新结果与产物见 [本地开发交付说明](local-handoff-2026-10-18.md)，请求体清洗范围见 [事务与隐私验收](transaction-privacy-acceptance-2026-10-18.md)。模型启用后已经增加本地事实及格式化联系方式的清洗、临时字段别名、个人资料指针人工确认和 Run 取消；ATS 缓存和映射记忆改为扩展源 IndexedDB；人工历史与 JD 改由后台增量处理，local/session 仅 trusted 上下文可直读写。所有后台 API 已有调用方策略，私有数据读取要求当前任务及浏览器实际文档授权，读取后再次复核；运行事件和任务释放摘要验证形状与来源。已有实际请求体、消息权限和持久化回归，但这些证据针对规定测试语料，不构成任意未知网页的绝对隐私保证。

## 运行模式结论

- 默认发布形态为 **Local-Only**：扩展默认运行时不存在任何网络出口请求，不存在云模型调用。
- 可选开启 **Cloud-Assisted（云端语义辅助，默认关闭）**：由用户在 Workbench「AI 模型设置」中显式启用并配置自己的 OpenAI 兼容接口（Base URL / API Key / Model）。开启后仅在本地规则无法识别字段时，把**经过本地清洗的字段标签、控件类型、区块类型等元信息**发送到用户配置的接口，用于返回简历路径建议。已知简历事实、格式化电话/邮箱/证件号码、长正文与原始字段键不会直接进入该请求；关闭时该通道完全无请求。
- 网络出口 API 只允许存在于 `src/background/ModelProvider.ts`（单测 `privacyBoundary.test.ts` 白名单校验，其余源码命中即失败）。
- PDF 简历解析完全在本地 Workbench 页面内完成（pdfjs-dist 打包内嵌，无任何外部请求）；解析结果必须先经用户预览与「确认导入」才会写入知识库。
- 模型服务的域名访问通过 Workbench「授权模型服务」按钮触发浏览器原生授权弹窗（`chrome.permissions.request`，必须用户手势），可在浏览器扩展管理页随时撤销；先用 `chrome.permissions.contains` 复核真值后才发起测试连接。
- Cloud-Assisted（主观题云端生成）未实现，`EssayGenerator` 为纯本地确定性生成。
- 网页内容（含 JD 描述、任意网页文本）只作为数据处理，不作为指令执行；模型提示词仅含字段元信息，且系统提示显式防御字段标签中的指令注入。

## 数据清单与存储边界

| 数据 | 存储位置 | 键/库 | 生命周期 |
|---|---|---|---|
| 简历事实及命名版本（可能含 PII） | IndexedDB | `applyfill` | 最多 20 个版本；清空简历删除全部版本 |
| 附件原文件（PDF 等） | IndexedDB | `applyfill-files` | 用户导入与清除 |
| ATS 指纹缓存（结构特征，无字段值） | 扩展源 IndexedDB | `applyfill-routing.atsMappings` | 500 条上限 |
| 映射记忆（host/标签/控件类型→简历路径，无字段值） | 扩展源 IndexedDB | `applyfill-routing.mappingMemory` | 500 条上限 |
| 字段修正记录（标签/类型/路径，无字段值） | `chrome.storage.local` | `applyfill.userCorrections.v2` | 200 条上限；删除标记与 epoch 阻止旧请求复活 |
| Frame 元数据 | `chrome.storage.session` | `applyfill.frames.v1` | 最多 500 条，启动与当前浏览器树核对 |
| 运行会话状态 | `chrome.storage.session` | `applyfill.run.*` | 浏览器会话级 |
| 岗位上下文（JD 文本，临时） | `chrome.storage.session` | `applyfill.jdContext.v2` | 6 小时 TTL、最多 50 项；按具体 Tab/Frame/documentId/URL 绑定，跨页需明确选择 |
| 用户保存的岗位版本（JD 文本） | `chrome.storage.local` | `applyfill.jobVersions.v1` | 最多 20 个；用户明确保存/删除，使用时绑定当前页面与授权子帧 |
| LLM 配置（Base URL / API Key / 模型名，API Key 为敏感项） | `chrome.storage.local` | `applyfill.llm.config.v1` | 仅本机浏览器存储；绝不发送给 content script；可在 Workbench 一键清除密钥 |

补充说明：

- local/session 均使用 `setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`；内容脚本不再直读写存储区，而是向后台提交所需增量。临时岗位和执行会话为浏览器会话级数据；用户明确保存的岗位版本保留在本机 local。修正历史的内容脚本消息只返回 epoch，不提供其他站点的历史列表。
- 映射记忆与修正记录只保存标签、控件类型与简历路径，不保存任何字段值（单测 `mappingMemory.test.ts` / `userCorrectionStore.test.ts` 校验）。
- 最终提交按钮永不由扩展点击（最终投递保护），不存在“误提交”数据外发路径。
- 简历附件解析（PDF → 文本 → 结构化事实）只读取 IndexedDB 中的附件副本，不读取页面内容，不产生网络请求；解析出的结构化事实默认 `source: resume-import`、`verified: false`，确认导入时由用户审核后标记为已核验。

## 自动化审计证据

1. 静态扫描（单测 `tests/unit/privacyBoundary.test.ts`）：递归扫描 `src/**/*.ts(x)`，匹配 `fetch(`、`new XMLHttpRequest`、`navigator.sendBeacon`、`new WebSocket`、`new EventSource`；`fetch` 仅允许出现在 `src/background/ModelProvider.ts`（LLM 通道唯一出口），其余命中即失败。当前通过（335 用例全绿，42 文件）。
2. 运行时网络捕获（e2e `privacy.spec.ts`）：在完整真实运行（导入简历 → 自动填写 react-native 页面 → VERIFIED）期间监听 Playwright context 的全部请求，断言不存在任何非 localhost 的 http(s) 请求；该场景 LLM 保持默认关闭。当前通过（e2e 44 用例全绿）。
3. LLM 通道单测（`tests/unit/llmRouting.test.ts`）：验证默认禁用时不发任何请求、启用后请求体只含字段元信息（不含简历值）、返回路径必须命中本地允许模板集、API Key 只出现在 Authorization 头且错误信息脱敏；并覆盖域名授权模式生成（`llmBaseUrlOriginPattern`）与默认 `fetch` 调用不丢失 this 绑定。
4. PDF 解析链路（单测 `tests/unit/resumeParser.test.ts` + e2e `resume-parse.spec.ts`）：验证解析产物默认未核验、确认导入后才进入知识库；解析全程无网络请求（e2e `privacy.spec.ts` 同一运行时网络捕获约束）。

## 构建与打包产物

- 构建：`pnpm --filter @applyfill/extension build`（WXT，输出 `.output/chrome-mv3`，总大小约 2.22 MB，含内嵌 pdfjs 文本解析 worker 1.38 MB）。
- 打包：`pnpm --filter @applyfill/extension zip` → `.output/applyfillextension-0.1.0-chrome.zip`
- 产物证据（2026-10-17）：
  - 大小：666,244 字节（约 651 kB）
  - SHA-256：`d43308c73e6dc767ebc84bf9facd28b1cbaa949adbe20ad923bdba5822fa7147`
  - 内容：`manifest.json`、`background.js`、`content-scripts/content.js`、`sidepanel.html`、`chunks/*`、`assets/*`（含 `pdf.worker.min-*.mjs` 本地解析 worker），无多余调试文件。
- 校验方式：`unzip -l` 检查清单；`sha256sum` 留档。

## 已知边界与后续

- 云端语义辅助（LLM）的现状边界：API Key 仍在本机 local 中，能读取浏览器配置目录的本机程序可能访问它；local 限制为 trusted 上下文，真实 Content Script 直读写已验证被拒绝，修改配置与连接测试消息也只接受扩展页面。后台全部消息已有调用方策略和对应回归，仍不能据此推断未知网页语料的独立隐私审计结果。工作台提供「清除密钥」。
- Cloud-Assisted（主观题云端生成）仍属设计允许的扩展方向，若后续实现，须满足：授权可见可取消、仅发送任务所需最少资料、发送前本地审查剥离 PII；当前版本仅实现字段路由级辅助。
- 临时岗位上下文与运行会话存放于 session；用户点击“保存岗位版本”后才跨会话保留 JD，使用保存版本也必须明确选择目标页面。
- PDF 解析为规则启发式：扫描件/图片型 PDF 明确提示无法提取文本，暂不提供 OCR；解析结果允许在预览框中人工修改后再确认导入，且 `uncertain` 列表标出未识别内容。
- 源码中无遥测、无崩溃上报、无第三方统计脚本。
