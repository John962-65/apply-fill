# ApplyFill 2.0

智能简历自动填写引擎（Resume Auto-Fill Agent）。浏览器扩展在用户授权下读取本地简历事实，扫描目标表单字段，建立确定性字段身份，在写事务租约保护下执行标准控件写入，并以 CommitPredicate 验证组件真实提交，全程不自动提交表单。

## 工程结构

```text
applyfill/
├── apps/extension/            WXT + React + TypeScript MV3 扩展
│   ├── src/entrypoints/       background / content / sidepanel / workbench
│   ├── src/shared/            契约、消息协议、错误、工具（最底层）
│   ├── src/resume/            ResumeSchema 三层编译（facts → normalized → projections）
│   ├── src/identity/          FieldIdentity 与确定性字段键
│   ├── src/guard/             FieldGuard、用户接管观察、写事务租约
│   ├── src/perceptor/         表单扫描与字段蒸馏
│   ├── src/router/            本地规则路由与路径解析
│   ├── src/formatter/         约束感知格式化
│   ├── src/actuator/          原生 Primitives 与字段执行引擎
│   ├── src/verifier/          CommitPredicate 与稳定性验证
│   ├── src/runtime/           内容脚本编排（扫描→映射→执行→摘要）
│   ├── src/background/        消息路由、会话状态、存储层
│   └── tests/unit/            Vitest 单元测试
└── packages/testbed/          React/Vue 动态靶场与 Playwright 回归
    ├── src/pages/             react-native / react-controlled / vue-controlled
    └── e2e/                   Playwright 用例与扩展加载辅助
```

## 常用命令

```bash
pnpm install                  # 安装依赖（自动执行 wxt prepare）
pnpm dev                      # 扩展开发模式（WXT）
pnpm dev:testbed              # 靶场开发服务器（http://localhost:5173）
pnpm typecheck                # 全仓类型检查
pnpm lint                     # ESLint（含模块边界规则）
pnpm lint:boundaries          # 验证别名/相对路径不能绕过模块边界
pnpm test                     # Vitest 单元测试
pnpm build                    # 构建扩展与靶场（扩展输出 apps/extension/.output/chrome-mv3）
pnpm test:e2e                 # Playwright E2E（自动构建扩展并启动靶场）
APPLYFILL_E2E_BROWSER=edge pnpm test:e2e # 使用本机 Microsoft Edge 与 Edge 构建
pnpm --filter @applyfill/extension zip  # Chrome ZIP
pnpm --filter @applyfill/extension exec wxt zip -b edge # Edge ZIP
```

## 架构边界

`eslint.config.js` 定义模块单向依赖：`shared → guard → resume/formatter → perceptor/identity → router → actuator → verifier → runtime → ui/background`。`resume` 与 `formatter` 禁止访问 DOM 全局（`resume/storage` 除外）。

## 当前状态

2026-10-21：根据解析和确认体验反馈，将 LLM 辅助解析接入导入主流程；新增按分组核对、可见原文、待处理筛选与补录，支持 API 输出格式兼容。62 文件 / 548 单测、Chrome/Edge 各 17 项相关专项、类型、lint 和双包校验通过。使用步骤和本轮证据见 [AI 简历解析与核对说明](docs/resume-ai-review-2026-10-21.md)。

当前为 **V2.1 Beta，本地开发已交付，可加载测试**。2026-10-18 按 `design.md` 重构任务协调、取消链路、字段身份、附件传输、简历编译、持久化与模块边界，并补齐简历/岗位版本、GPA/奖项事实、主观题切面审核、异步日期、消息调用方权限和可追溯报告。真实招聘网站按用户安排由用户本地测试，反馈后继续修复。

2026-10-18 历史全量验证：57 个单测文件 / 520 用例、Chrome 94 项、Edge 94 项全部通过。安装包已由后续版本替换；最新验证范围、安装包记录以上方 AI 解析说明为准。这些功能回归不替代真实 ATS 与独立 KPI 验收。

安装、使用、接口迁移、实际验证范围及已知限制见 [本地开发交付说明](docs/local-handoff-2026-10-18.md)。[V2.1 重构审计](docs/refactor-audit-2026-10-18.md) 保留设计要求的追踪；此前 Week 1–5 及各轮验收报告为历史快照。真实 ATS、独立 KPI 和远端 CI 未执行，分别记录，未宣称完整设计五大门禁全部通过。
