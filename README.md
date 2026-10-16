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
│   ├── src/background/        消息路由、会话状态、储层
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
pnpm test                     # Vitest 单元测试
pnpm build                    # 构建扩展（.output/chrome-mv3）
pnpm test:e2e                 # Playwright E2E（自动构建扩展并启动靶场）
```

## 架构边界

`eslint.config.js` 定义模块单向依赖：`shared → guard → resume/formatter → perceptor/identity → router → actuator → verifier → runtime → ui/background`。`resume` 与 `formatter` 禁止访问 DOM 全局（`resume/storage` 除外）。

## 当前状态

Week 1 已完成并通过验收：标准字段（text/textarea/number/email/select/checkbox/radio）可填写并验证，React/Vue 受控组件与重绘场景通过，用户接管与任务取消受保护。详见 `docs/week1-acceptance.md`。
