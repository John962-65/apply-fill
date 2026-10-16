# 智能简历自动填写引擎（Resume Auto-Fill Agent）
# V2.1 正式开发任务书与五周工程执行计划

**项目名称：** Resume Auto-Fill Agent  
**项目代号：** ApplyFill 2.0  
**任务书版本：** V2.1 Final Engineering Baseline  
**修订日期：** 2026 年 10 月 15 日  
**开发周期：** 5 周核心开发 + 后续 ATS 兼容性迭代  
**目标平台：** Chrome / Edge 桌面浏览器  
**核心技术栈：** WXT + React + TypeScript + Manifest V3 + IndexedDB + LLM + 确定性状态机  
**工程组织：** 双包 Monorepo + 内部模块单向依赖  
**项目性质：** 可实际使用的智能招聘表单自动填写浏览器扩展

---

# 第一章 项目定位与总体目标

## 1.1 项目背景

当前招聘网站广泛采用 React、Vue、Ant Design、Element Plus、MUI、飞书 UD、北森 Phoenix 等前端技术和组件库。

不同招聘系统的表单结构、字段命名、控件交互方式及数据验证机制存在明显差异。

传统自动填写插件通常采用以下方式：

1. 通过标签或 CSS 选择器查找输入框。
2. 根据简历字段名匹配网页字段。
3. 使用 `.value`、`click()` 或 `dispatchEvent()` 执行填写。
4. 根据 DOM 当前显示内容判断是否成功。

这类方案在标准 HTML 表单中能够工作，但在复杂招聘系统中容易出现：

- 日期搜索框已输入内容，却未真正选中日期。
- React/Vue 受控组件重渲染后恢复旧值。
- Portal 浮层脱离原始表单容器，导致选项定位错误。
- 教育、实习、项目经历动态扩容后产生跨段错填。
- 学历、地区等上游字段变化，清空下游已填写字段。
- SPA 多步骤切换后无法重新识别当前表单。
- iframe 内嵌表单无法被顶层脚本直接访问。
- 用户手动修改被插件后续自动填写覆盖。
- 自动化操作失败但系统错误报告为成功。

这些问题的根源不仅在于字段识别能力不足，更在于缺乏**可靠的状态观测、执行调度、组件提交验证及失败恢复机制**。

因此，本项目不采用依靠 LLM 直接控制整个页面的单一 Agent 架构，而是设计一套模块化、可验证、可恢复的智能表单执行系统。

## 1.2 项目核心定位

> 构建基于离线三层简历知识库、两阶段表单拓扑感知、分层语义指针路由、三波次屏障调度、专用控件状态机、确定性字段重锚定及写入事务保护的智能招聘表单自动填写引擎。

核心目标包括：

**目标一：高准确率字段映射**

能够理解不同招聘系统中的字段语义，并准确绑定至结构化简历数据。

**目标二：复杂组件可靠交互**

能够处理原生输入框、自定义下拉框、虚拟滚动、三级级联、异构日期和动态经历区块。

**目标三：避免假成功**

将“执行动作”与“组件正式接受目标值”严格区分。

**目标四：防止数据串写与用户输入覆盖**

使用逻辑字段身份、重锚定机制和写入事务锁，保障 DOM 重绘前后的字段一致性。

**目标五：有限执行与自动恢复**

所有动作必须具有明确的操作预算、超时机制、状态进展检测和人工接管入口。

**目标六：隐私可控与低成本复用**

通过离线简历预编译、JSON Path 指针路由和 ATS 模板缓存，减少重复计算及个人数据外发。

**目标七：工程可持续维护**

采用轻量双包 Monorepo，避免过度工程化，同时通过模块边界规则保持架构清晰。

---

# 第二章 V2.1 架构冻结与四项关键补丁

## 2.1 V2.1 设计冻结清单

以下设计作为正式开发基线，不在后续开发过程中随意推翻。

| 核心机制 | V2.1 最终决定 |
|---|---|
| 浏览器扩展 | Chrome / Edge Manifest V3 |
| 开发框架 | WXT + React + TypeScript |
| 运行载体 | Workbench + SidePanel + Content Script + Background |
| 简历管理 | 离线三层预编译简历知识库 |
| 表单识别 | Repeater 先扩容，再进行 Scoped Field Distillation |
| 字段映射 | L0 指纹缓存 → L1 本地规则 → L2 可选 LLM |
| 字段身份 | `FieldIdentity` + `DeterministicFieldKey` |
| DOM 重锚定 | Content Witness + 局部拓扑复合指纹 + 歧义保护 |
| 调度方式 | 三波次屏障调度 + 动态依赖修正 |
| 快路径 | 原生输入接口与受控组件状态验证 |
| 慢路径 | SelectAgent / CascaderWalker / DateAgent |
| 成功判定 | `WAIT_COMMIT → VERIFYING → CommitPredicate` |
| 用户保护 | `FieldGuard + WriteTransactionLease` |
| 任务安全 | 有限预算 + 熔断 + 取消机制 |
| 浏览器权限 | 最小权限，生产版不依赖 CDP |
| 附件上传 | File / DataTransfer 尝试 + 验证 + 人工兜底 |
| 数据存储 | IndexedDB + `chrome.storage.session` |
| 工程结构 | 两个物理 Workspace 包 |
| 回归测试 | React/Vue 动态靶场 + Playwright |
| 最终提交 | 默认禁止自动最终提交 |

## 2.2 V2.1 补丁总览

本次修订重点解决 V2.0 四处实现断层。

| 补丁 | 原问题 | V2.1 解决方案 |
|---|---|---|
| PATCH-01 | DOM 重绘后无法可靠恢复字段身份 | 内容证人 + 确定性复合指纹 + 分级重锚定 |
| PATCH-02 | 静态 DependencyGraph 难以识别网页隐藏联动关系 | 三波次屏障调度 + 动态重扫 |
| PATCH-03 | 11 包 Monorepo 过重 | 两个物理包 + ESLint 单向依赖 |
| PATCH-04 | 用户输入与 Agent 写入缺少可执行的并发保护机制 | WriteTransactionLease + AbortController + 写入版本 |

### 四项补丁的安全边界

以下三个地方必须明确，不能把启发式方案写成绝对保证。

**第一，内容证人不是绝对唯一身份。**

两个项目可能具有相同名称，用户也可能修改项目标题，因此项目名称只能作为重锚定证据之一。若证据冲突或存在多个候选，必须停止自动绑定。

**第二，三波次调度不是完整依赖关系证明。**

普通文本框也可能触发地区、专业、单位等字段联动。因此，三波次只作为低成本默认策略，仍需动态重扫、状态验证与运行时依赖修正。

**第三，`event.isTrusted === true` 不等于一定是用户亲自操作。**

该属性表明事件由浏览器用户代理生成，而非简单的 `dispatchEvent()` 合成事件；部分浏览器 API 产生的事件也可能是可信事件。因此，必须结合事件类型、目标字段、Agent 当前事务和交互上下文综合判断。[MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted?utm_source=chatgpt.com)

以上三条同样属于 V2.1 强制开发规范。

---

# 第三章 核心工程指标（KPI）与验收标准

## 3.1 质量指标

| 考核维度 | 目标 | 统计口径 | 优先级 |
|---|---|---|---|
| 字段语义映射准确率 | ≥98% | 独立人工标注字段集 | P0 |
| 常规字段自动填写覆盖率 | ≥98% | 原生及标准受控输入框 | P0 |
| 跨经历区块错填率 | 0 | 指定三段及以上经历回归集 | P0 |
| 用户修改被自动覆盖次数 | 0 | 用户修改、重扫、重绘及并发测试 | P0 |
| 已知假成功用例通过率 | 100% | 所有故意制造的未提交状态必须识别 | P0 |
| 异常控件有限终止率 | 100% | 未知组件、无响应组件及超时场景 | P0 |
| 字段执行结果可追溯率 | 100% | 每次自动动作都有结果和失败原因 | P0 |
| 人工接管入口覆盖率 | 100% | 所有不能可靠自动完成的字段 | P0 |
| Local-Only 简历数据外发 | 0 字节 | 云端模型与遥测服务 | P0 |
| 端到端字段自动完成率 | ≥90% | 符合条件且有数据来源的字段 | P1 |
| 真实 ATS 整页自动完成率 | ≥90% | 独立真实站点测试集 | P1 |

上述 0 错误是**规定测试范围内的验收目标**，不能解释为对所有未知网站提供数学意义上的零错误保证。

## 3.2 性能指标

| 考核维度 | 目标 | 统计边界 |
|---|---|---|
| L0/L1 本地字段路由 | P95 <150ms | 不包含网页提交等待 |
| 标准控件提交与验证 | P95 <300ms | 稳定本地测试环境 |
| 首次 LLM 指针路由 | P50 <600ms | 正常网络及选定模型，优化目标 |
| 复杂 Select 单控件执行 | P50 <1.5s | 不含异常超时 |
| 同模板二次访问 Token | 降低 ≥90% | 缓存通过语义校验 |
| Form Scanner | P95 <500ms | 指定中等规模表单 |
| Repeater 单次扩容 | 按真实响应测量 | 不使用固定等待作为成功依据 |
| DateAgent | 按组件难度分组统计 | 不以统一 1.2s 限制跨年日历 |
| 恢复与取消 | 保证有界停止 | 通过故障注入验证 |

其中：

- **P50**：50% 样本耗时不超过对应值。
- **P95**：95% 样本耗时不超过对应值。

性能测试必须明确浏览器版本、硬件环境、网络条件和样本数量。

## 3.3 四类成功率必须分别统计

### Field Mapping Accuracy

衡量字段是否正确映射到简历数据。

### Field Commit Success

衡量目标值是否真正被网页组件接受。

### Auto-Fill Coverage

衡量符合自动填写条件的字段中，最终正确完成的比例。

### End-to-End Success

衡量完整网申页面中，所有符合范围的必填字段是否全部正确完成。

**禁止以字段覆盖率代替整页成功率。**

此外：

```text
DOM 写入成功 ≠ 字段提交成功
字段提交成功 ≠ 整页完成
整页填写完成 ≠ 已正式投递
```

这是项目的统一统计规范。

---

# 第四章 系统总体架构

## 4.1 四端协同架构

保留 V2.0 的四端设计。

```text
┌─────────────────────────────────────────┐
│       Full-Screen Workbench             │
│                                         │
│  简历导入、管理、预编译、审核             │
│  岗位版本管理、隐私配置、历史记忆         │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│              SidePanel                  │
│                                         │
│  扫描 / 填写 / 暂停 / 取消                │
│  执行进度、失败处理、人工接管             │
│  主观题生成与人工确认                    │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│       Background Service Worker         │
│                                         │
│  TabCoordinator                         │
│  FrameRegistry                          │
│  MessageRouter                          │
│  SessionStore                           │
│  LLM Gateway                            │
│  Global Execution Lease                 │
└──────────────────┬──────────────────────┘
                   │
       ┌───────────┴────────────┐
       ▼                        ▼
┌──────────────┐         ┌──────────────┐
│ Content     │         │ Content      │
│ Frame A     │         │ Frame B      │
│             │         │              │
│ Perceptor   │         │ Perceptor    │
│ Actuator    │         │ Actuator     │
│ Verifier    │         │ Verifier     │
│ FieldGuard  │         │ FieldGuard   │
└──────────────┘         └──────────────┘
       │                        │
       └───────────┬────────────┘
                   ▼
┌─────────────────────────────────────────┐
│             Core Engine                 │
│                                         │
│  ResumeCompiler                         │
│        ↓                                │
│  FormPerceptor                          │
│        ↓                                │
│  SemanticRouter                         │
│        ↓                                │
│  WaveScheduler                          │
│        ↓                                │
│  FieldExecutionEngine                   │
│        ↓                                │
│  CommitPredicate                        │
│        ↓                                │
│  Recovery / Human-in-the-Loop           │
└─────────────────────────────────────────┘
```

## 4.2 各端职责

### Workbench

负责结构化简历管理。

- 简历导入、编辑和审核。
- 三层简历预编译。
- 项目描述多长度切面。
- 简历版本管理。
- 模型配置。
- 本地数据清理。
- 用户明确授权的云端辅助功能。

Workbench 不直接操作招聘网页。

### SidePanel

负责任务交互。

- 启动当前页面扫描。
- 预览字段映射。
- 开始、暂停、恢复和取消填写。
- 查看每个字段的执行状态。
- 处理失败字段。
- 主观题草稿生成和审核。

SidePanel 不直接持有子帧 DOM 节点。

### Content Script

负责页面内执行。

- DOM / Open Shadow DOM 扫描。
- 表单结构识别。
- Repeater 扩容。
- 字段身份重锚定。
- Portal 浮层追踪。
- 快慢路径执行。
- 字段事务保护。
- CommitPredicate 验证。
- 悬浮胶囊展示。

### Background

负责跨运行环境协调。

- 建立任务身份。
- 注册 Frame。
- 合并字段签名。
- 批量路由未知字段。
- 维护任务与跨帧执行许可。
- 处理权限。
- 恢复任务状态。
- 统一向 SidePanel 汇报结果。

Background 不依靠全局内存变量永久保存任务状态。

Chrome Manifest V3 的 Service Worker 可能被终止，内存变量会随之丢失，因此需要持久化任务信息。[Chrome Developers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle?hl=en\&utm_source=chatgpt.com)

## 4.3 完整自动填写流程

```text
打开招聘页面
       │
       ▼
用户启动填写
       │
       ▼
创建 RunContext
       │
       ▼
FrameRegistry 收集有效表单
       │
       ▼
Phase 1：识别 Repeater
       │
       ▼
安全扩容、绑定经历实例
       │
       ▼
Phase 2：蒸馏字段签名
       │
       ▼
L0 缓存 / L1 规则 / L2 LLM
       │
       ▼
生成 FieldExecutionPlan
       │
       ▼
Wave 1：结构开关与级联根
       │
       ▼
屏障：等待稳定、增量重扫
       │
       ▼
Wave 2：剩余复杂控件
       │
       ▼
屏障：重锚定、修正执行计划
       │
       ▼
Wave 3：文本叶子节点
       │
       ▼
逐字段 CommitPredicate 验证
       │
       ▼
DirtyChecker 终态复检
       │
       ├── VERIFIED
       │
       ├── BOUNDED_RETRY
       │
       └── NEEDS_MANUAL
                │
                ▼
          QuickFillPill
                │
                ▼
          SidePanel 报告
```

---

# 第五章 离线三层简历知识库

## 5.1 Layer 0：原始事实层

保存用户确认的原始事实。

主要包含：

- 个人基本信息。
- 教育经历。
- 工作与实习经历。
- 科研及项目经历。
- 技能与证书。
- 奖项与其他补充信息。
- 用户上传的简历附件。

事实层必须保留来源信息和核验状态。

```typescript
interface ResumeFact<T> {
  value: T;

  source:
    | "user"
    | "resume-import"
    | "verified-document";

  verified: boolean;
  updatedAt: number;
}
```

LLM 不允许擅自修改原始事实。

## 5.2 Layer 1：规范化语义层

负责日期、学历、专业、单位等标准化。

```typescript
interface DateAtom {
  year: number;
  month?: number;
  day?: number;

  precision: "year" | "month" | "day";

  isPresent?: boolean;
}
```

时间必须保留原始精度。

例如只有 `2026 年`，不能凭空补成 `2026 年 1 月 1 日`。

规范化后的教育经历：

```typescript
interface EducationEntry {
  id: string;

  school: string;
  degree: string;
  major: string;

  startDate: DateAtom;
  endDate: DateAtom;

  schoolLabels?: string[];

  gpa?: {
    value: number;
    scale: number;
  };
}
```

学校标签、学历等级等信息必须由可信规则或用户核验确认。

## 5.3 Layer 2：表单适配切面层

每段项目经历至少生成以下内容：

| 字段 | 内容 |
|---|---|
| `title` | 项目名称 |
| `one_liner` | 约 50 字的精简介绍 |
| `summary_150` | 约 150 字的综合介绍 |
| `responsibilities` | 个人职责 |
| `outcomes` | 真实成果 |
| `full_description` | 完整描述 |
| `keywords` | 技术关键词 |

这些文本均必须从 Layer 0 的事实派生。

允许润色表达，不允许篡改实验结果或编造工作经历。

## 5.4 数据完整性要求

所有预编译数据必须：

1. 保留事实来源。
2. 可以人工审核。
3. 可以编辑。
4. 可以重新生成。
5. 可以导出。
6. 可以删除。
7. 不依赖云端服务才能使用已有数据。

简历编译器采用确定性预处理与可选 LLM 文本生成分离的设计。

---

# 第六章 PATCH-01：逻辑字段身份与确定性重锚定机制

**模块优先级：P0**

本章替代 V2.0 中尚未具体实现的字段重锚定设计。

## 6.1 核心问题

React/Vue 可能将整个经历表单卸载并重新渲染。

旧节点：

```html
<input id="project-name" value="项目A">
```

被销毁后，产生一个新的 DOM 节点：

```html
<input id="project-name" value="项目A">
```

虽然页面显示内容相同，但两个节点不是同一个对象。

旧节点上的：

- WeakMap 记录；
- JS 引用；
- 自定义属性；
- 临时事件监听器；

都不能直接作为新节点的身份依据。

因此，V2.1 必须支持：

> **根据稳定的业务上下文和字段结构，重新识别 DOM 节点所属的逻辑字段，同时继承正确的 FieldGuard。**

## 6.2 三层身份体系

建立三个相互独立的身份。

### A. ResumeEntryId

代表简历库中的某段经历。

例如：

```text
resume.project.paco
resume.project.mdc
resume.project.vlm
```

该 ID 在简历数据中持久存在。

### B. FormInstanceId

代表网页表单中的某个经历实例。

例如：

```text
form.project.instance_01
form.project.instance_02
form.project.instance_03
```

这个 ID 由插件维护，不依赖网页提供的 `id` 属性。

### C. DeterministicFieldKey

代表某个经历实例内部的具体字段。

例如：

```text
form.project.instance_02.start_month
```

三者形成映射：

```text
ResumeEntryId
      │
      ▼
FormInstanceId
      │
      ▼
DeterministicFieldKey
      │
      ▼
Current DOM Node
```

DOM 节点允许变化，逻辑身份尽量保持稳定。

## 6.3 Content Witness：内容证人机制

### 目的

当经历区块被重绘或重排序时，通过已填写的核心字段判断某个新 DOM 容器可能对应哪段简历经历。

### 内容证人选择

不同区块使用不同的候选锚点：

| 区块 | 首选内容证人 | 辅助证人 |
|---|---|---|
| 教育经历 | 学校名称 | 学历、专业、起止时间 |
| 工作经历 | 公司名称 | 职位、部门、起止时间 |
| 项目经历 | 项目名称 | 开始时间、项目描述特征 |
| 实习经历 | 实习单位 | 岗位、起止时间 |

例如：

```text
DOM 区块 A
项目名称：多机械臂协同规划
开始时间：2025-03

DOM 区块 B
项目名称：机械臂增量碰撞验证
开始时间：2025-08
```

可以使用这些信息辅助恢复对应的 ResumeEntryId。

### 内容证人不得单独决定身份

必须考虑以下异常：

**情况一：重复名称**

两个项目可能名称相同。

**情况二：用户手动修改**

用户可能将“多机械臂协同规划”修改为“多机器人运动规划系统”。

**情况三：新增空白经历**

新 DOM 区块没有任何已填内容。

**情况四：字段值被页面重置**

React 重绘后，项目名称可能暂时为空。

**情况五：页面自动格式化**

网页可能改变日期或项目标题的显示格式。

因此，采用多证据匹配机制，而不是简单地执行：

```typescript
if (domTitle === resumeTitle) {
  bindInstance();
}
```

## 6.4 实例级重锚定算法

### 第一阶段：建立候选实例

针对新的 DOM 区块，查找同一表单步骤、同一 SectionType 下的候选 FormInstance。

### 第二阶段：提取重锚定证据

建议使用以下证据：

1. **稳定网页标识**：真实可复用的组件业务 ID、字段 `name`、稳定表单标记。
2. **区块上下文**：所属表单、步骤、经历类型和附近标题。
3. **内容证人**：项目名称、学校名称、公司名称等已确认字段。
4. **辅助值**：日期、专业、职位等辅助字段。
5. **结构拓扑**：同一区块内部字段集合及其语义关系。
6. **历史绑定关系**：上一版本已验证的 ResumeEntryId 和字段身份。

### 第三阶段：候选打分

可以定义：

\[
S(i,j)=
w_1S_{\mathrm{stable}}
+w_2S_{\mathrm{witness}}
+w_3S_{\mathrm{context}}
+w_4S_{\mathrm{topology}}
\]

其中：

- \(i\)：当前新 DOM 区块。
- \(j\)：历史逻辑实例。
- \(S(i,j)\)：二者属于同一实例的综合匹配分数。
- \(S_{\mathrm{stable}}\)：稳定业务标识一致性。
- \(S_{\mathrm{witness}}\)：内容证人一致性。
- \(S_{\mathrm{context}}\)：表单上下文一致性。
- \(S_{\mathrm{topology}}\)：字段结构一致性。
- \(w_1,\ldots,w_4\)：各证据权重。

**注意：该公式是候选评分模型，不是身份唯一性证明。**

权重与阈值必须通过测试集确定，不能仅凭开发者主观设置后宣称准确。

### 第四阶段：全局一对一匹配

不能让两个新 DOM 区块同时认领同一个历史 FormInstanceId。

需要在同一经历列表中进行一对一分配。

对于实例数较少的招聘表单，可以采用简单的候选排序与冲突检查；存在多个相似实例时，再使用二分图最大权匹配等方法。

### 第五阶段：歧义保护

满足以下条件之一，必须拒绝自动恢复：

- 多个候选得分接近。
- 没有可信内容证人或稳定业务标识。
- 网页结构发生重大变化。
- 重新绑定结果与用户修改历史冲突。
- 同一历史实例被多个 DOM 区块竞争。
- 只能依靠旧的列表索引推断身份。

此时标记：

```typescript
status = "REANCHOR_AMBIGUOUS";
```

暂停相关区块执行，提示用户确认。

不能为了提高自动完成率而随机选择。

## 6.5 DeterministicFieldKey：字段级复合指纹

V2.1 使用复合字段身份。

基础公式：

\[
K_f = H(
F,
S,
I,
L,
C,
R,
D
)
\]

其中：

- \(K_f\)：确定性字段键。
- \(H\)：稳定的哈希算法。
- \(F\)：逻辑表单身份。
- \(S\)：字段所属区块类型。
- \(I\)：已经确认的 FormInstanceId。
- \(L\)：规范化字段标签。
- \(C\)：控件类别。
- \(R\)：字段语义角色。
- \(D\)：同名字段的局部消歧信息。

示例：

```typescript
interface DeterministicFieldDescriptor {
  formId: string;
  stepId: string;

  sectionType: string;
  instanceId: string;

  normalizedLabel: string;
  controlKind: string;

  semanticRole?: string;

  disambiguator?: {
    groupLabel?: string;
    fieldName?: string;
    stableAttribute?: string;
    sameLabelSiblingIndex?: number;
  };
}
```

需要特别注意：

**`sameLabelSiblingIndex` 只能是备用消歧信息，不能作为稳定身份的唯一来源。**

因为 React 重绘、条件字段插入以及表单重排序，都可能改变同名字段的相对序号。

只有在确认同名控件数量、父级语义组和结构顺序均未改变时，才允许使用该索引恢复身份。

否则进入歧义状态。

### 哈希实现

可采用稳定序列化后的 SHA-256 或其他适合本地索引的确定性哈希算法。

要求：

- 输入规范化。
- 字段顺序固定。
- Schema 版本参与计算。
- 避免语言环境导致序列化差异。
- 哈希只用于索引，不作为唯一性证明。
- 不直接把姓名、电话、身份证号等个人值写入字段结构哈希。

Content Witness 中涉及个人数据的证据保留在本地，且不进入遥测日志。

## 6.6 ReanchorManager 接口

```typescript
interface ReanchorResult {
  status:
    | "MATCHED"
    | "AMBIGUOUS"
    | "NOT_FOUND"
    | "NEW_INSTANCE";

  instanceId?: string;
  fieldKey?: string;

  evidence: {
    stableIdMatched: boolean;
    witnessMatched: boolean;
    topologyMatched: boolean;
    contextMatched: boolean;
  };

  confidence?: number;
}
```

核心接口：

```typescript
interface ReanchorManager {
  reanchorInstance(
    section: Element,
    previousInstances: FormInstanceSnapshot[]
  ): Promise<ReanchorResult>;

  reanchorField(
    element: Element,
    instanceId: string
  ): Promise<ReanchorResult>;
}
```

### 强制规则

只有 `MATCHED` 且无候选冲突时，才能恢复旧 FieldGuard。

`AMBIGUOUS` 不得自动继承任何旧实例的写入权限。

对于已经匹配的用户保护字段，新的 DOM 节点必须继承：

```text
owner = user
lockState = user-protected
```

### 特殊情况：页面值丢失

如果某个用户修改过的字段在重绘后变成空白，不能立即用旧简历值补填。

系统应保留用户修改保护状态，并提示：

```text
该字段之前由你手动修改，但页面重新渲染后值可能丢失。
请确认是否恢复之前的值。
```

仅在有可靠的原始用户值记录及用户授权时，才允许恢复。

## 6.7 PATCH-01 验收测试

| 编号 | 测试场景 | 验收结果 |
|---|---|---|
| RA01 | React 整块 DOM 重建 | 正确恢复字段逻辑身份 |
| RA02 | 项目顺序改变 | 不按旧索引错误绑定 |
| RA03 | 中途插入空白项目 | 不影响已有项目绑定 |
| RA04 | 删除第二段项目 | 第三段不错误继承第二段状态 |
| RA05 | 两个项目同名 | 无法消歧时请求人工确认 |
| RA06 | 用户修改项目标题 | 保护状态不丢失 |
| RA07 | 网页清空字段值 | 不误认为新字段 |
| RA08 | 同名字段顺序变化 | 不错误继承 FieldGuard |
| RA09 | 区块重新挂载但语义一致 | 成功重新绑定 |
| RA10 | 仅有模糊结构证据 | 拒绝自动恢复 |

**PATCH-01 完成标准：**

已确认身份能够在重绘后恢复；无法证明身份时必须安全停止，不能发生错误继承。

---

# 第七章 PATCH-02：三波次拓扑屏障调度器

**模块优先级：P0**

本章替代 V2.0 中要求预先构建完整 DependencyGraph 的重型方案。

## 7.1 核心设计

V2.1 不要求系统预先推断整个网页所有字段之间的依赖关系。

改为：

> **基于控件类型和可观测联动的三波次默认调度，并在运行中动态修正依赖。**

核心组件命名：

```text
WaveScheduler
```

不再将完整静态依赖图作为 MVP 的前置条件。

但保留轻量：

```text
RuntimeDependencyRegistry
```

用于记录已知或执行过程中发现的依赖关系。

## 7.2 Wave 1：结构开关与级联根

### 执行对象

主要包括：

- 决定其他字段是否显示的 Radio。
- 控制表单分支的 Checkbox。
- 学历、证件类型等上游选择器。
- 省市区级联控件的根节点。
- “至今”“仍在职”等日期联动开关。
- 会触发后续字段重建的主选择器。

### 默认执行方式

同一 Tab 内串行执行。

```text
Wave 1
   │
   ├── 学历
   ├── 是否在职
   ├── 证件类型
   └── 地区级联根
```

每执行一个结构性控件，都必须检查是否出现：

- 新字段。
- 字段消失。
- 选项变化。
- 表单区块变化。
- 已填写字段被清空。

如果发生结构变化，先更新 DOMRevision，再执行下一项。

### 重要限制

不是所有 Radio / Checkbox 都必须属于 Wave 1。

例如普通的“是否接受短信通知”未必触发其他字段。

应根据控件语义、附近表单结构及已观测行为分类。

无法判断时，可以采用保守的提前串行执行策略。

## 7.3 Wave 1 Barrier：结构稳定屏障

Wave 1 完成后必须执行：

```text
停止发起新操作
      ↓
等待关键 DOM 变化完成
      ↓
比较前后字段集合
      ↓
更新 DOMRevision
      ↓
重锚定已有实例
      ↓
发现新增字段
      ↓
更新执行计划
      ↓
进入 Wave 2
```

这里的 Barrier（屏障）指：后续批次必须等待前一批次完成必要的验证和状态整理。

### DOM 稳定判据

不采用单纯：

```typescript
await sleep(300);
```

而使用：

```text
最短观察窗口
+
MutationObserver
+
关键节点状态检查
+
最大等待超时
```

建议初始配置：

```typescript
interface DomStabilityConfig {
  quietWindowMs: number;
  maxWaitMs: number;
}
```

例如：

```typescript
const defaultDomStability = {
  quietWindowMs: 200,
  maxWaitMs: 2000,
};
```

这是待测试调整的初始参数，不是所有网站统一适用的常数。

对于无关动画或持续变化的页面元素，应限定观察范围，避免广告、计时器等导致屏障永远无法结束。

## 7.4 Wave 2：剩余复杂控件

### 执行对象

包括：

- 自定义 Select。
- Searchable Select。
- 日期选择器。
- 日期范围。
- Cascader 剩余层级。
- 需要打开浮层才能完成的其他控件。

### 调度方式

采用：

```text
按表单逻辑顺序
+
同一 Tab 浮层互斥
+
执行后状态验证
```

默认串行。

例如：

```text
Wave 2

学校名称 Select
       ↓
专业 Select
       ↓
开始时间 DateAgent
       ↓
结束时间 DateAgent
```

每个控件都必须完成：

```text
EXECUTING
    ↓
WAIT_COMMIT
    ↓
VERIFYING
    ↓
VERIFIED / FAILED
```

才能释放对相关控件的执行许可。

### 动态依赖发现

如果选择学校后发现专业候选列表发生变化，记录：

```text
school_select → major_select
```

如果填写某个字段后观察到另一个字段被重置，记录：

```text
source_field → affected_field
```

这些依赖作为本次运行的调度修正依据。

只有经过多个有效样本验证的稳定依赖，才允许写入长期缓存。

不能将单次 DOM 变化误判为永久业务依赖。

## 7.5 Wave 2 Barrier：字段计划重整

Wave 2 完成后：

1. 等待当前表单稳定。
2. 执行增量字段扫描。
3. 检查旧节点是否失效。
4. 调用 ReanchorManager。
5. 更新新增字段映射。
6. 检查已经完成的字段是否被清空。
7. 更新字段执行优先级。
8. 生成 Wave 3 的可执行集合。

未通过重锚定的字段不能进入自动填写队列。

## 7.6 Wave 3：文本叶子字段

### 默认执行对象

包括：

- 姓名。
- 电话。
- 邮箱。
- 项目标题。
- 项目描述。
- 工作职责。
- GPA。
- 其他不具有已知下游联动的文本字段。

### 执行策略

默认采用**有限并发**。

但必须满足：

1. 没有未完成的上游依赖。
2. 不属于动态扩容中的区块。
3. 当前字段身份已确认。
4. 没有用户修改保护。
5. 不与其他正在执行的控件共享冲突状态。
6. 当前网站或组件未被标记为顺序敏感。

对于未知 React/Vue 表单，初期优先采用保守串行或很小的并发度。

只有回归测试证明多个字段可以安全并发时，才扩大并发规模。

### 为什么不无条件并发

某些文本输入框也会引发联动：

```text
邮编输入
    ↓
自动填充城市
```

或者：

```text
输入专业关键词
    ↓
触发异步候选搜索
```

因此，不能将“普通文本框”当作没有副作用的保证。

### 运行时降级

一旦发现文本字段写入后引发其他字段变化：

```text
停止当前批次的新任务
        ↓
等待已启动动作安全结束或取消
        ↓
重新扫描和验证
        ↓
记录动态依赖
        ↓
切换保守串行执行
```

## 7.7 WaveScheduler 接口

```typescript
type ExecutionWave =
  | "STRUCTURAL"
  | "COMPLEX"
  | "LEAF";

interface ScheduledField {
  fieldKey: string;
  wave: ExecutionWave;

  priority: number;
  mayMutateStructure: boolean;

  dependencies: string[];
}

interface WaveExecutionResult {
  wave: ExecutionWave;

  completed: string[];
  failed: string[];

  domChanged: boolean;
  requiresRescan: boolean;
}
```

核心接口：

```typescript
interface WaveScheduler {
  classify(
    fields: FieldSignature[]
  ): ScheduledField[];

  executeWave(
    wave: ExecutionWave,
    signal: AbortSignal
  ): Promise<WaveExecutionResult>;

  reconcileAfterWave(
    result: WaveExecutionResult
  ): Promise<void>;
}
```

## 7.8 动态依赖管理

保留轻量 RuntimeDependencyRegistry。

```typescript
interface RuntimeDependency {
  sourceFieldKey: string;
  targetFieldKey: string;

  reason:
    | "OPTION_CHANGED"
    | "FIELD_APPEARED"
    | "FIELD_DISAPPEARED"
    | "VALUE_RESET";

  observedAt: number;
  confidence: number;
}
```

要求：

- 能检测明显的运行时依赖。
- 能避免重复执行相同字段。
- 能识别循环依赖并停止。
- 不要求开发完整静态 DAG 分析器。
- 允许未知依赖触发终态 DirtyChecker。

## 7.9 PATCH-02 验收测试

| 编号 | 场景 | 验收条件 |
|---|---|---|
| WS01 | 先选学历再填专业 | 专业值不回滚 |
| WS02 | 省市区联动 | 按层级顺序完成 |
| WS03 | “至今”切换 | 结束日期正确禁用或启用 |
| WS04 | 选择选项后生成新字段 | 新字段被增量发现 |
| WS05 | 日期控件修改后重绘文本框 | 文本字段最终正确 |
| WS06 | 文本输入触发下游联动 | 检测并修正顺序 |
| WS07 | 多个独立输入框 | 无冲突时可以并发 |
| WS08 | 未知组件产生联动 | 降级串行 |
| WS09 | 字段依赖出现循环 | 有界终止 |
| WS10 | Wave 中途取消 | 不再启动后续动作 |

**PATCH-02 完成标准：**

三波次调度可以正确处理已知联动场景；出现未知依赖时能够动态调整或安全退出。

---

# 第八章 PATCH-03：双包 Monorepo 与模块依赖边界

**模块优先级：P0**

## 8.1 工程组织原则

V2.0 将各个逻辑模块拆分为多个独立 Workspace 包，会增加以下成本：

- 多个 `package.json`。
- 包导出和 TypeScript 路径配置。
- 构建顺序维护。
- 跨包引用管理。
- 循环依赖排查。
- AI 编码助手的跨包上下文检索成本。

V2.1 改为：

> **物理上只保留两个 Workspace 包，逻辑上继续维持严格的模块化边界。**

两个包分别是：

```text
apps/extension
packages/testbed
```

其中：

`apps/extension` 包含插件及全部核心业务引擎。

`packages/testbed` 包含动态表单测试靶场。

不再为 `router`、`actuator`、`verifier` 等模块单独创建 npm 包。

## 8.2 V2.1 最终代码目录

```text
resume-auto-fill-agent/
│
├── apps/
│   └── extension/
│       │
│       ├── entrypoints/
│       │   ├── background.ts
│       │   ├── content.ts
│       │   │
│       │   ├── sidepanel/
│       │   │   ├── index.html
│       │   │   ├── main.tsx
│       │   │   └── App.tsx
│       │   │
│       │   └── workbench/
│       │       ├── index.html
│       │       ├── main.tsx
│       │       └── App.tsx
│       │
│       ├── src/
│       │   │
│       │   ├── shared/
│       │   │   ├── types/
│       │   │   ├── contracts/
│       │   │   ├── messages/
│       │   │   ├── errors/
│       │   │   └── utils/
│       │   │
│       │   ├── resume/
│       │   │   ├── schema/
│       │   │   ├── compiler/
│       │   │   ├── projections/
│       │   │   └── storage/
│       │   │
│       │   ├── background/
│       │   │   ├── TabCoordinator.ts
│       │   │   ├── FrameRegistry.ts
│       │   │   ├── MessageRouter.ts
│       │   │   ├── SessionStore.ts
│       │   │   ├── ExecutionLeaseManager.ts
│       │   │   └── LLMGateway.ts
│       │   │
│       │   ├── perceptor/
│       │   │   ├── FormScanner.ts
│       │   │   ├── SectionScanner.ts
│       │   │   ├── RepeaterManager.ts
│       │   │   ├── FieldDistiller.ts
│       │   │   ├── PortalTracker.ts
│       │   │   ├── DOMRevisionTracker.ts
│       │   │   └── FormScopeRegistry.ts
│       │   │
│       │   ├── identity/
│       │   │   ├── FieldIdentity.ts
│       │   │   ├── DeterministicFieldKey.ts
│       │   │   ├── ContentWitness.ts
│       │   │   ├── ReanchorManager.ts
│       │   │   └── FormInstanceRegistry.ts
│       │   │
│       │   ├── router/
│       │   │   ├── FingerprintCache.ts
│       │   │   ├── FastRuleMatcher.ts
│       │   │   ├── BatchLLMRouter.ts
│       │   │   ├── RouteValidator.ts
│       │   │   └── ConfidencePolicy.ts
│       │   │
│       │   ├── formatter/
│       │   │   ├── ConstraintAwareFormatter.ts
│       │   │   ├── DateFormatter.ts
│       │   │   ├── SalaryNormalizer.ts
│       │   │   └── TextProjectionSelector.ts
│       │   │
│       │   ├── scheduler/
│       │   │   ├── WaveScheduler.ts
│       │   │   ├── WaveClassifier.ts
│       │   │   ├── WaveBarrier.ts
│       │   │   ├── RuntimeDependencyRegistry.ts
│       │   │   └── ExecutionMutex.ts
│       │   │
│       │   ├── actuator/
│       │   │   ├── FieldExecutionEngine.ts
│       │   │   ├── Primitives.ts
│       │   │   ├── SelectAgent.ts
│       │   │   ├── CascaderWalker.ts
│       │   │   ├── DateAgent.ts
│       │   │   ├── FileUploadAgent.ts
│       │   │   └── ExecutionBudget.ts
│       │   │
│       │   ├── guard/
│       │   │   ├── FieldGuard.ts
│       │   │   ├── WriteTransactionLease.ts
│       │   │   ├── UserInteractionObserver.ts
│       │   │   └── GuardRegistry.ts
│       │   │
│       │   ├── verifier/
│       │   │   ├── CommitPredicate.ts
│       │   │   ├── FieldVerifier.ts
│       │   │   ├── DirtyChecker.ts
│       │   │   ├── ValidationErrorDetector.ts
│       │   │   └── RecoveryPlanner.ts
│       │   │
│       │   ├── memory/
│       │   │   ├── MappingMemory.ts
│       │   │   └── UserCorrectionStore.ts
│       │   │
│       │   ├── jd/
│       │   │   ├── JDSniffer.ts
│       │   │   ├── ApplicationContext.ts
│       │   │   └── EssayGenerator.ts
│       │   │
│       │   └── ui/
│       │       ├── QuickFillPill.tsx
│       │       ├── FieldStatusOverlay.tsx
│       │       └── FieldReviewPanel.tsx
│       │
│       ├── tests/
│       │   ├── unit/
│       │   ├── integration/
│       │   └── privacy/
│       │
│       ├── wxt.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   └── testbed/
│       ├── src/
│       │   ├── react/
│       │   │   ├── native-form/
│       │   │   ├── antd-form/
│       │   │   ├── mui-form/
│       │   │   └── repeater-form/
│       │   │
│       │   ├── vue/
│       │   │   ├── native-form/
│       │   │   └── element-plus-form/
│       │   │
│       │   ├── scenarios/
│       │   │   ├── searchable-select/
│       │   │   ├── portal-select/
│       │   │   ├── virtual-scroll/
│       │   │   ├── cascader/
│       │   │   ├── date-picker/
│       │   │   ├── iframe/
│       │   │   ├── spa-wizard/
│       │   │   ├── reanchor/
│       │   │   ├── user-interrupt/
│       │   │   └── failure-recovery/
│       │   │
│       │   └── fixtures/
│       │
│       ├── e2e/
│       ├── playwright.config.ts
│       └── package.json
│
├── docs/
│   ├── architecture.md
│   ├── resume-schema.md
│   ├── field-identity.md
│   ├── reanchor-algorithm.md
│   ├── wave-scheduler.md
│   ├── write-transaction.md
│   ├── commit-predicates.md
│   ├── privacy-model.md
│   ├── test-plan.md
│   └── known-limitations.md
│
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── pnpm-workspace.yaml
├── package.json
├── pnpm-lock.yaml
├── eslint.config.js
└── README.md
```

以上是目标目录结构，不要求第一周创建所有文件。

只在对应功能开始开发时建立必要模块。

WXT 使用 `entrypoints/` 发现扩展入口，也支持在配置中调整源代码目录，因此应明确插件项目根目录为 `apps/extension`，避免错误地让 WXT 从仓库根目录搜索入口。[WXT](https://wxt.dev/guide/essentials/project-structure?utm_source=chatgpt.com)

## 8.3 模块依赖方向

要求建立以下单向依赖：

```text
                  shared
                    ↑
           resume / formatter
                    ↑
           perceptor / identity
                    ↑
                  router
                    ↑
                scheduler
                    ↑
                actuator
                    ↑
                verifier
                    ↑
           runtime orchestration
                    ↑
             UI / Background
```

上图表示允许的依赖方向，不要求所有相邻模块彼此依赖。

特别规定：

- `perceptor` 不得导入 `actuator`。
- `identity` 不得导入 `scheduler`。
- `router` 不得导入 `actuator`。
- `resume` 不得依赖 DOM。
- `formatter` 不得依赖浏览器运行环境。
- `actuator` 不得直接导入 React UI。
- `verifier` 可以依赖共享状态契约，但不应反向控制整个调度器。
- `scheduler` 通过共享接口调用执行能力，不直接依赖所有专用控件的具体实现。

### 处理循环依赖的规则

对于需要双向协作的模块，使用：

```text
共享接口
+
依赖注入
+
事件或回调
```

例如：

```text
WaveScheduler
       │
       ▼
FieldExecutor Interface
       ▲
       │
FieldExecutionEngine
```

而不是：

```text
scheduler import actuator
actuator import scheduler
```

## 8.4 ESLint 模块边界门禁

使用：

```text
import/no-restricted-paths
```

或等效的模块边界检查规则，限制非法跨目录导入。

另外配置循环依赖检测。

要求：

1. 模块边界由 CI 自动检查。
2. 不允许通过深层相对路径绕过。
3. 不允许通过路径别名绕过。
4. 不允许以关闭整个 ESLint 规则的方式解决循环依赖。
5. 新模块必须说明允许的依赖方向。

对于跨模块通信，优先在 `shared/contracts/` 定义接口。

## 8.5 双包开发命令

建议根目录提供：

```bash
pnpm install

pnpm dev
pnpm build

pnpm typecheck
pnpm lint

pnpm test
pnpm test:e2e
```

内部通过 Workspace 脚本协调扩展和测试靶场。

开发期应能够：

- 独立启动插件开发模式。
- 独立启动测试靶场。
- 在浏览器中加载插件。
- 单独测试某个执行器。
- 运行完整 E2E。
- 快速进行代码热更新或扩展重载。

## 8.6 PATCH-03 验收标准

- 仅两个物理 Workspace 包。
- 不需要为每个核心业务模块创建独立 npm 包。
- WXT 构建正常。
- React/Vue 靶场可以独立运行。
- TypeScript 跨模块类型正确。
- ESLint 能拦截非法导入。
- 无核心模块循环依赖。
- AI 编码助手可以在单个插件源码目录内完成主要业务开发。

---

# 第九章 PATCH-04：WriteTransactionLease 写入租约算法

**模块优先级：P0**

本章将 V2.0 的 FieldGuard 从状态定义升级为可执行的并发保护机制。

## 9.1 核心目标

解决以下竞争问题：

```text
Agent 准备填写字段
        │
        ▼
Agent 开始执行
        │
        ├── 用户同时点击该字段
        │
        ├── 用户按键修改
        │
        └── 页面触发联动更新
        │
        ▼
Agent 继续执行剩余动作
        │
        ▼
用户输入被覆盖
```

V2.1 引入：

> **FieldGuard + WriteTransactionLease + AbortController + UserInteractionObserver。**

其中：

- `FieldGuard` 保存字段的逻辑保护状态。
- `WriteTransactionLease` 保存 Agent 当前写入权限。
- `AbortController` 负责通知异步执行链取消。
- `UserInteractionObserver` 负责发现外部交互及用户接管。

## 9.2 FieldGuard 数据结构

```typescript
interface FieldGuard {
  fieldKey: string;

  owner: "none" | "agent" | "user";

  lockState:
    | "unlocked"
    | "agent-running"
    | "user-protected";

  lastAgentWriteVersion: number;
  lastUserEditVersion: number;

  activeAgentTxId?: string;

  lastVerifiedValue?: unknown;

  updatedAt: number;
}
```

FieldGuard 应当与逻辑字段身份绑定，而不是只与当前 DOM 节点绑定。

## 9.3 WriteTransactionLease 数据结构

```typescript
interface WriteTransactionLease {
  txId: string;

  runId: string;
  fieldKey: string;

  targetDomRevision: number;

  expectedValue: unknown;

  acquiredAt: number;
  expiresAt: number;

  guardVersion: number;

  status:
    | "ACTIVE"
    | "COMMITTED"
    | "REVOKED"
    | "EXPIRED"
    | "RELEASED";
}
```

每个字段同一时刻最多存在一个有效写入租约。

租约只代表 Agent 在特定时间窗口内获得执行许可，不代表执行已经成功。

## 9.4 写入租约获取流程

```text
Agent 准备写入
        ↓
读取 FieldGuard
        ↓
检查是否 user-protected
        │
        ├── 是 → 拒绝执行
        │
        └── 否
             ↓
      检查当前 Run 是否有效
             ↓
      检查 DOMRevision
             ↓
      检查是否已有活跃租约
             ↓
      获取 WriteTransactionLease
             ↓
      创建 AbortController
             ↓
      进入 EXECUTING
```

获取租约与修改字段状态必须由同一个字段执行管理器协调。

不得由多个异步任务各自读取状态、判断空闲后同时写入。

## 9.5 Agent 写入事务流程

```text
ACQUIRE_LEASE
      ↓
CHECK_GUARD
      ↓
CHECK_DOM_REVISION
      ↓
EXECUTE_ACTION
      ↓
WAIT_COMMIT
      ↓
CHECK_LEASE
      ↓
VERIFY
      │
      ├── 成功
      │     ↓
      │   COMMITTED
      │
      ├── 用户接管
      │     ↓
      │   REVOKED
      │
      ├── 过期
      │     ↓
      │   EXPIRED
      │
      └── 验证失败
            ↓
          RETRYABLE / NEEDS_MANUAL
```

每次需要 `await` 页面变化、动画、候选加载或异步任务之后，都必须重新确认：

- 当前 Run 是否有效。
- 当前租约是否仍有效。
- DOMRevision 是否变化。
- FieldGuard 是否被用户保护。
- AbortSignal 是否已取消。

对于真正执行写入的同步动作，必须在动作开始前最后一次检查租约。

## 9.6 UserInteractionObserver

在页面捕获阶段监听：

```typescript
const interactionEvents = [
  "pointerdown",
  "keydown",
  "beforeinput",
  "input",
  "paste",
  "compositionstart",
  "change",
];
```

这些事件具有不同含义，不能一律按同一种方式处理。

### A. 直接编辑意图

例如：

```text
keydown
beforeinput
paste
compositionstart
```

当事件可归属于某个正在由 Agent 操作的字段，并符合用户输入意图时，应优先撤销 Agent 租约。

### B. 指针接管

例如用户点击正在操作的下拉框、日期框或其弹层。

若点击发生在该字段实际交互区域内，并且不是插件自己的 UI 操作，应暂停对应 Agent 动作。

### C. 纯焦点或导航事件

例如：

```text
focus
blur
鼠标悬停
Tab 导航
```

不能单凭这些事件认定用户修改了字段。

否则正常的自动填写可能被错误中断。

### D. 值变化检测

如果字段值发生变化，但变化无法归因于 Agent 当前事务，则应将其视为外部修改或页面联动。

根据实际情况：

- 用户修改：保护字段。
- 页面联动：标记需要重新验证。
- 来源不确定：停止自动覆盖，等待确认。

## 9.7 `isTrusted` 使用规则

生产版本不启用 CDP 可信点击，因此可以把可信的编辑类事件作为用户接管的重要信号。

但不能使用以下简单逻辑：

```typescript
if (event.isTrusted) {
  guard.owner = "user";
}
```

因为可信事件不必然代表真实的人类编辑，而且事件也可能来自页面自身的行为。[MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted?utm_source=chatgpt.com)

推荐判定流程：

```text
收到事件
    ↓
根据 composedPath / 当前交互区域
确定所属逻辑字段
    ↓
确认是否属于 Agent 控件或关联 Portal
    ↓
排除插件自身管理的 UI 事件
    ↓
判断事件是否表示编辑或明确接管意图
    ↓
检查当前事务和已知动作来源
    ↓
撤销对应字段的 Agent 租约
    ↓
保护用户操作
```

对于没有可信事件、但最终值发生异常变化的情况，仍需通过快照比较检测。

## 9.8 用户接管时的取消机制

当用户在 Agent 执行期间主动编辑字段：

```text
USER_INTERACTION
        ↓
找到 FieldKey
        ↓
FieldGuard 更新
        ↓
lastUserEditVersion += 1
        ↓
lease.status = REVOKED
        ↓
AbortController.abort()
        ↓
Agent 当前状态机收到 USER_INTERRUPTED
        ↓
停止后续动作
        ↓
释放执行许可
        ↓
UI 标记用户接管
```

### 重要工程要求

AbortController 不能撤回已经发生的 DOM 写入或点击。

因此必须同时使用：

1. **动作前检查。**
2. **异步等待后检查。**
3. **执行完成后的保护版本检查。**
4. **所有权冲突后的最终状态验证。**

如果用户输入与 Agent 已经完成的同步动作发生竞争，无法保证仅靠 AbortController 完全避免冲突。

系统应尽可能将用户接管检测提前，并在发现冲突后禁止继续写入，必要时提示用户核对当前值。

## 9.9 写入租约过期

每个租约必须有有限有效期。

建议初始配置：

```typescript
interface WriteLeaseConfig {
  defaultTtlMs: number;
  maxTtlMs: number;
}
```

例如：

```typescript
const writeLeaseConfig = {
  defaultTtlMs: 3000,
  maxTtlMs: 10000,
};
```

这是初始建议值，需要根据复杂控件实际执行耗时调整。

对于长时间运行的日期翻页或异步候选加载，可以在确认任务仍有效且持续取得进展时安全续租。

禁止无限续租。

租约过期必须释放执行许可，但不能自动把字段状态标记为成功。

## 9.10 租约与状态持久化

采用两级状态：

**Content Script 本地：**

保存当前 DOM 节点、AbortController、执行上下文、临时租约。

**Background / SessionStore：**

保存 Run 身份、Frame 身份、跨帧执行许可及有效任务版本。

Browser Service Worker 重启后，不得假设旧租约仍然可安全继续执行。

必须重新检查：

```text
Run 是否仍有效
Frame 是否仍存在
DocumentId 是否变化
FieldGuard 是否一致
页面值是否已经提交
```

如果存在不确定性，优先重新验证而不是重放动作。

### 取消后不可继续执行

所有挂起的异步回调必须检查 Run 和租约版本。

例如：

```text
用户取消任务
      ↓
旧 SelectAgent 正在等待候选加载
      ↓
候选 2 秒后出现
      ↓
旧 Agent 不得继续点击
```

## 9.11 核心伪代码

```typescript
async function executeField(
  field: ExecutableField,
  signal: AbortSignal
): Promise<FieldExecutionResult> {
  const lease = guardRegistry.acquire(field);

  const controller = new AbortController();

  const onParentAbort = () => {
    controller.abort("RUN_CANCELLED");
  };

  signal.addEventListener("abort", onParentAbort, {
    once: true,
  });

  try {
    assertLeaseActive(lease);

    const element = reanchorManager.resolve(field);

    assertFieldIdentity(element, field);

    assertLeaseActive(lease);

    await actuator.execute({
      field,
      element,
      lease,
      signal: controller.signal,
    });

    assertLeaseActive(lease);

    const result = await verifier.verify({
      field,
      lease,
      signal: controller.signal,
    });

    assertLeaseActive(lease);

    if (!result.committed) {
      return {
        status: "RETRYABLE",
        reason: "COMMIT_NOT_CONFIRMED",
      };
    }

    guardRegistry.markVerified(lease);

    return {
      status: "VERIFIED",
    };
  } catch (error) {
    return classifyExecutionError(error);
  } finally {
    signal.removeEventListener("abort", onParentAbort);
    guardRegistry.release(lease);
  }
}
```

以上为接口级伪代码。

具体实现必须解决：

- 父任务取消与租约撤销同时发生。
- 租约过期时主动触发当前 AbortController。
- 重复释放租约。
- 验证完成前用户版本变化。
- 异步回调在任务取消后恢复。
- 不同状态更新之间的竞争。

## 9.12 PATCH-04 验收测试

| 编号 | 测试场景 | 预期结果 |
|---|---|---|
| WL01 | Agent 正常填写 | 正确取得和释放租约 |
| WL02 | 用户在 Agent 输入前接管 | Agent 不再写入 |
| WL03 | 用户在异步等待期间接管 | 后续动作取消 |
| WL04 | 用户在下拉框展开后点击 | Agent 不抢夺焦点 |
| WL05 | 用户修改已完成字段 | 字段进入 user-protected |
| WL06 | 页面触发受控状态变化 | 正确区分联动与用户接管 |
| WL07 | Agent 任务超时 | 租约释放 |
| WL08 | DOM 重绘 | 旧租约失效 |
| WL09 | Run 被取消 | 旧回调不继续执行 |
| WL10 | 两个任务争抢同一字段 | 至多一个持有有效租约 |
| WL11 | 输入法组合输入 | 不覆盖正在进行的组合输入 |
| WL12 | 用户点击无关页面区域 | 不错误锁定当前字段 |
| WL13 | 页面脚本触发 focus | 不误判为用户修改 |
| WL14 | 用户修改后页面再次重绘 | FieldGuard 仍有效 |
| WL15 | 旧 Agent 延迟返回成功 | 不得覆盖当前任务状态 |

**PATCH-04 完成标准：**

用户接管优先于自动操作，已撤销或过期的租约不能产生新的字段写入；所有异步动作均能安全退出。

---

# 第十章 FieldExecutionEngine 与 CommitPredicate

**模块优先级：P0**

本章保留 V2.0 的核心状态机，并补充每类控件的实际提交判据。

## 10.1 统一字段执行状态机

```typescript
type FieldStatus =
  | "DISCOVERED"
  | "MAPPED"
  | "READY"
  | "EXECUTING"
  | "WAIT_COMMIT"
  | "VERIFYING"
  | "VERIFIED"
  | "RETRYABLE"
  | "CIRCUIT_BROKEN"
  | "NEEDS_MANUAL"
  | "USER_OVERRIDDEN"
  | "CANCELLED";
```

状态流转：

```text
DISCOVERED
    ↓
MAPPED
    ↓
READY
    ↓
EXECUTING
    ↓
WAIT_COMMIT
    ↓
VERIFYING
    │
    ├── VERIFIED
    │
    ├── RETRYABLE ──→ EXECUTING
    │
    ├── CIRCUIT_BROKEN
    │        ↓
    │   NEEDS_MANUAL
    │
    ├── USER_OVERRIDDEN
    │
    └── CANCELLED
```

### 强制规则

**R1：** 只有完成字段身份和语义映射验证，才能进入 `READY`。

**R2：** 执行前必须取得有效的 WriteTransactionLease。

**R3：** 不允许从 `EXECUTING` 直接跳转到 `VERIFIED`。

**R4：** 每个字段必须拥有对应的 CommitPredicate。

**R5：** 验证时发现 FieldGuard 版本变化，必须重新检查执行结果。

**R6：** 自动重试必须具有次数、时间和无进展预算。

**R7：** 发生用户接管时立即中止相关执行链。

**R8：** 验证失败不得向缓存写入成功经验。

## 10.2 CommitPredicate：组件提交判据

V2.1 新增核心接口：

```typescript
type CommitStatus =
  | "CONFIRMED"
  | "REJECTED"
  | "UNKNOWN";

interface CommitEvidence {
  kind:
    | "DOM_VALUE"
    | "SELECTED_OPTION"
    | "ARIA_STATE"
    | "FORM_VALUE"
    | "COMPONENT_STATE"
    | "VALIDATION_STATE"
    | "STABILITY_CHECK";

  matched: boolean;
  detail?: string;
}

interface CommitResult {
  status: CommitStatus;

  observedValue?: unknown;

  evidence: CommitEvidence[];

  failureReason?: string;
}

interface CommitPredicate {
  verify(
    context: FieldExecutionContext
  ): Promise<CommitResult>;
}
```

使用三态结果，而不是简单的布尔值。

### 为什么需要 UNKNOWN

对于某些自定义组件，插件可能只能观察到页面显示内容，而无法确认真正的业务状态。

例如：

```text
页面显示：2026 年 1 月

但内部提交模型无法观察
```

这种情况不能被自动解释为绝对成功。

若缺少足够证据，应返回：

```text
UNKNOWN
```

并提示用户核对。

在本地动态靶场中，可以额外检查 React/Vue 的真实业务状态；但在生产环境中，不能假设扩展可以任意读取组件内部状态。

## 10.3 各类控件提交判据

| 控件类型 | 主要证据 | 辅助证据 |
|---|---|---|
| 原生 Input | 当前有效值等于目标值 | 失焦及重绘后保持 |
| 原生 Select | `selectedOptions` 匹配 | 表单值正确 |
| Checkbox | `checked` 符合目标 | 联动状态正确 |
| Radio | 正确选项被选中 | 同组其他选项状态正确 |
| React/Vue Input | 值稳定，受控重绘后不回滚 | 靶场业务状态一致 |
| Searchable Select | 已选项与目标一致 | 搜索模式退出、表单值正确 |
| 多选 Select | 已选集合与目标集合一致 | 关联隐藏值或表单值正确 |
| Cascader | 完整层级路径一致 | 子级选择状态正确 |
| DatePicker | 规范化日期一致 | 组件已完成提交 |
| DateRangePicker | 起止日期均正确 | 范围约束通过 |
| File Upload | 文件已进入网站有效待上传状态 | 上传控件或进度状态正确 |
| 主观题 Textarea | 最终文本一致 | 字数与前端校验通过 |

注意：浮层关闭只能作为辅助证据，不能单独作为成功判据。

部分多选组件在正确选中后仍保持浮层打开。

对于组件触发的异步业务验证，应等待可观察的验证结果，而不是只检查点击之后的一瞬间。

## 10.4 标准控件执行原语

`Primitives.ts` 至少提供：

```typescript
interface NativePrimitives {
  setTextValue(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
    signal: AbortSignal
  ): Promise<void>;

  setSelectValue(
    element: HTMLSelectElement,
    value: string,
    signal: AbortSignal
  ): Promise<void>;

  setChecked(
    element: HTMLInputElement,
    checked: boolean,
    signal: AbortSignal
  ): Promise<void>;
}
```

原生输入执行流程：

```text
检查字段身份
      ↓
检查写入租约
      ↓
选择适合组件的输入方法
      ↓
执行原生属性操作
      ↓
派发需要的事件
      ↓
等待可观察状态变化
      ↓
重新读取
      ↓
CommitPredicate
```

不允许向所有控件无差别派发完整的鼠标、键盘、指针事件链。

## 10.5 SelectAgent

状态机：

```text
LOCATE_TRIGGER
      ↓
OPEN
      ↓
LOCATE_POPUP
      ↓
SEARCH / ENUMERATE
      ↓
MATCH_OPTION
      ↓
SELECT
      ↓
WAIT_COMMIT
      ↓
VERIFY
```

要求支持：

- 原生 Select。
- React Select。
- Ant Design Select。
- MUI Autocomplete。
- Element Plus Select。
- 飞书 UD。
- 北森 Phoenix。
- Moka 自定义下拉框。
- Portal / Teleport。
- 虚拟滚动列表。

### 搜索与正式选中分离

例如目标月份为 `1`：

```text
输入 1
    ↓
出现 1、10、11、12
    ↓
匹配完整选项语义
    ↓
选择 1
    ↓
检查正式已选值
```

仅出现筛选结果不代表成功。

## 10.6 CascaderWalker

状态机：

```text
OPEN
  ↓
SELECT_LEVEL_0
  ↓
WAIT_CHILDREN
  ↓
SELECT_LEVEL_1
  ↓
WAIT_CHILDREN
  ↓
SELECT_LEVEL_2
  ↓
VERIFY_PATH
```

级联组件每一步都必须检查：

- 目标列是否存在。
- 当前列是否仍有效。
- 候选项是否唯一。
- 子列是否真实出现。
- 最终路径是否与简历一致。

不允许只根据浮层宽度变化推断层级已经加载成功。

## 10.7 DateAgent

支持：

- 原生日期。
- 年份选择。
- 月份选择。
- 年月双下拉。
- 年月日选择。
- 日期范围。
- 只读日历。
- 跨年翻页。
- “至今”联动。

采用：

```text
日期组件分类
      ↓
选择执行策略
      ↓
按目标日期步进
      ↓
每步验证进展
      ↓
完成日期提交
      ↓
CommitPredicate
```

### 动态预算

```typescript
interface ExecutionBudget {
  maxActions: number;
  maxElapsedMs: number;

  maxNoProgress: number;
  maxRetries: number;
}
```

初始建议：

| 控件 | 最大动作数 | 最大总耗时 | 连续无进展上限 |
|---|---:|---:|---:|
| 普通 Select | 8 | 5s | 2 |
| 搜索 Select | 12 | 8s | 2 |
| Cascader | 18 | 12s | 2 |
| DatePicker | 60 | 20s | 2 |
| Repeater 单次扩容 | 5 | 8s | 1 |

这些值属于首版测试参数，可根据组件特点配置。

### 无进展的定义

不能简单地以“点击之后 100ms 内文本没变化”判断无进展。

必须：

1. 等待当前操作可能引发的异步更新。
2. 观察 Header、候选集合或组件状态。
3. 判断是否向目标状态推进。
4. 超过等待预算仍无变化，记录一次无进展。

连续两次确认无有效进展后，默认触发熔断。

## 10.8 DirtyChecker：终态验证

三波次完成后，统一执行：

```text
重新扫描当前页面
      ↓
检查已验证字段
      ↓
检查值是否保持
      ↓
检查用户修改保护状态
      ↓
检查校验提示
      ↓
检查新增必填项
      ↓
必要时执行有界补填
      ↓
输出最终报告
```

对于已经出现联动清空的字段，优先判断是否允许安全补填。

如果上游条件发生变化或字段身份无法确认，不得直接重新写入旧值。

---

# 第十一章 表单感知、跨帧与 SPA 协同

## 11.1 两阶段表单感知

### Phase 1：Section Discovery

先扫描：

- 基本信息。
- 教育经历。
- 实习经历。
- 工作经历。
- 项目经历。
- 技能证书。
- 主观题。
- 附件区域。

识别 Repeater 并按需要安全扩容。

扩容必须具备：

```text
扩容前实例数量
+
当前按钮所属 Section
+
扩容后的新实例证据
```

### Phase 2：Scoped Field Distillation

在实例绑定完成后，提取字段签名。

```typescript
interface FieldSignature {
  fieldKey: string;

  label: string;
  placeholder?: string;

  controlKind: string;
  inputType?: string;

  sectionType: string;
  instanceId: string;

  required: boolean;
  readonly: boolean;
  disabled: boolean;

  options?: string[];

  constraints?: {
    min?: string;
    max?: string;
    step?: string;
    maxLength?: number;
    pattern?: string;
  };

  componentHints: string[];
}
```

字段签名发送给路由器。

真实 DOM 节点只能在所属 Frame 的执行上下文中操作。

## 11.2 PortalTracker

点击控件前后进行浮层观测。

定义：

\[
\Delta S=S_{\mathrm{after}}-S_{\mathrm{before}}
\]

其中：

- \(S_{\mathrm{before}}\)：打开前可见或活跃的浮层集合。
- \(S_{\mathrm{after}}\)：打开后可见或活跃的浮层集合。

同时检测：

- `aria-expanded`。
- `aria-controls`。
- 可见性变化。
- 节点集合变化。
- 焦点变化。
- 几何位置关系。
- 候选文本变化。

不能只检测新增 DOM 节点，因为部分弹层会预先挂载。

## 11.3 跨域 iframe

采用：

```text
TabCoordinator
      │
      ├── FrameRegistry
      │       ├── Frame A
      │       ├── Frame B
      │       └── Frame C
      │
      └── Unified Execution Run
```

每个 Frame 独立扫描并报告字段。

Background 统一生成执行任务。

跨域访问必须具备对应权限，不能仅依靠 `allFrames: true`。

Chrome 会独立检查每个 Frame 是否符合注入匹配条件。[Chrome Developers](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts?utm_source=chatgpt.com)

Frame 身份至少包括：

```typescript
interface FrameIdentity {
  tabId: number;
  frameId: number;
  documentId: string;
}
```

遇到不可访问的 Frame 时：

- 不假装已经扫描成功。
- 不尝试绕过浏览器安全边界。
- 向用户提供权限申请或人工处理入口。

## 11.4 SPA 多步骤表单

使用：

```text
webNavigation
+
MutationObserver
+
StepFingerprint
```

联合识别步骤变化。

不能只依赖 URL 是否变化。

步骤切换后：

```text
暂停任务
    ↓
等待表单稳定
    ↓
判断当前 Step
    ↓
重新发现字段
    ↓
重新执行重锚定
    ↓
保护用户修改
    ↓
更新 WaveScheduler
    ↓
恢复任务
```

默认不自动点击“下一步”及“最终提交”。

## 11.5 Service Worker 生命周期

运行状态必须区分：

- 当前任务状态。
- 当前 Frame 注册。
- 当前执行许可。
- 当前页面 DOM 状态。
- 长期简历数据与缓存。

存储策略：

| 数据类型 | 存储位置 |
|---|---|
| 当前 Run 状态 | `chrome.storage.session` |
| FrameRegistry 元数据 | `chrome.storage.session` |
| 临时 JD 上下文 | `chrome.storage.session` |
| 简历知识库 | IndexedDB |
| 已验证 ATS 缓存 | IndexedDB |
| 用户设置 | `chrome.storage.local` |
| DOM 节点引用 | Content Script 内存 |
| AbortController | 当前执行上下文内存 |

`chrome.storage.session` 可以帮助跨 Service Worker 休眠恢复状态，但浏览器重启、扩展重载或更新后会被清除，不能把它当成永久持久化数据库。[Chrome Developers](https://developer.chrome.com/docs/extensions/reference/api/storage?utm_source=chatgpt.com)

浏览器重启后应重新开始页面检查，不自动恢复未完成的 DOM 点击序列。

---

# 第十二章 语义路由、缓存与隐私

## 12.1 三层路由机制

```text
L0：ATS Fingerprint Cache
              ↓
L1：FastRuleMatcher
              ↓
L2：BatchLLMRouter
```

### L0

优先匹配已经验证的表单指纹。

支持模板级与站点级缓存。

缓存必须包含版本及语义上下文，不能因为两家公司都使用北森，就认为全部字段完全相同。

### L1

使用：

- 标签规范化。
- 同义词字典。
- 字段上下文。
- 所属 Section。
- 控件类型。
- 简历 Schema。
- 字段约束。

完成确定性路由。

### L2

对剩余未知字段进行批量 LLM 指针路由。

示例：

```json
{
  "fieldId": "education_school",
  "selectedPath": "$resume.education[1].school",
  "reasonCode": "SCHOOL_FIELD"
}
```

LLM 不直接生成可执行 DOM 操作，也不能返回任意代码。

## 12.2 Constraint-Aware Formatter

执行前读取字段约束：

```text
type
min
max
step
maxlength
pattern
required
readonly
disabled
单位说明
```

处理：

- GPA 数值提取。
- 日期格式转换。
- 文本长度适配。
- 明确单位下的薪资转换。
- 枚举值规范化。

不允许擅自将薪资区间变成未经用户确认的单值。

不允许通过修改实际 GPA 等方式满足输入框限制。

## 12.3 隐私运行模式

### Local-Only

个人简历事实保留本地。

只允许向模型发送经过本地审查、不含个人简历信息的字段元数据，或者完全关闭云端请求。

不得上传：

- 真实姓名。
- 手机号。
- 身份证号。
- 家庭住址。
- 原始简历 PDF。
- 未授权的项目或教育经历正文。
- 包含个人信息的页面快照。

### Cloud-Assisted

用户明确授权后，允许发送完成指定任务所需的最少资料。

例如主观题生成可以使用用户选择的项目经历切面。

授权范围必须可见、可取消。

## 12.4 ATS Fingerprint Cache

缓存键至少包含：

```text
ATS 类型或组件特征
+
表单步骤
+
Section 语义
+
字段标签和类型
+
字段约束
+
相关结构特征
+
缓存 Schema 版本
```

缓存命中后仍需做上下文验证。

当字段标签、约束、分组或身份发生重大变化时，缓存失效。

## 12.5 自学习记忆

`MappingMemory` 主要记录：

```text
网页字段语义
        ↕
简历 JSON Path
```

以及经过验证的控件适配经验。

默认不把用户输入的敏感字段值当作通用缓存。

用户手动更改某项简历内容时，系统应请求确认是否写回简历知识库。

---

# 第十三章 附件上传、主观题与人机协同

## 13.1 FileUploadAgent

生产版本优先使用标准浏览器文件 API。

```text
Workbench 中用户选择 PDF
           ↓
授权本地存储
           ↓
File / Blob 保存至 IndexedDB
           ↓
检测目标网页 file input
           ↓
尝试 DataTransfer / files 接口
           ↓
触发必要的 change 事件
           ↓
验证网页是否接受文件
           │
     ┌─────┴─────┐
     ▼           ▼
   成功          失败
                 ↓
              人工上传
```

文件是否成功，不能只依据：

```text
input.files.length > 0
```

还应尽可能验证网站自己的文件接收状态。

浏览器标准的文件输入元素具有 `files` 属性，但这并不意味着所有自定义上传组件都会接受程序化设置的文件。[MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/files?utm_source=chatgpt.com)

### CDP 策略

生产版本不声明 `debugger` 权限。

如果后续确实需要 CDP：

- 使用单独实验性构建。
- 明确告知用户权限风险。
- 不与普通生产安装包混合。
- 不纳入 MVP 必选交付。

Chrome 官方明确将 `debugger` 列为不能声明为 optional 的权限之一。[Chrome Developers](https://developer.chrome.com/docs/extensions/reference/api/permissions?hl=en\&utm_source=chatgpt.com)

## 13.2 JD-Aware Essay Agent

用于处理开放式主观题。

前置 JD 嗅探时，缓存：

- 岗位名称。
- 职位描述。
- 工作职责。
- 技术要求。
- 公司与申请上下文。
- 缓存有效期。

主观题生成流程：

```text
识别主观题
      ↓
显示「结合 JD 生成」
      ↓
用户主动触发
      ↓
确认使用的简历切面
      ↓
生成草稿
      ↓
SidePanel 预览
      ↓
用户编辑 / 确认
      ↓
写入网页
      ↓
CommitPredicate 验证
```

不直接将未完成的流式输出写入招聘网站输入框。

## 13.3 QuickFillPill

对于自动填写失败字段：

- 展示失败原因。
- 提供目标值预览。
- 支持复制。
- 支持重新选择字段来源。
- 支持单字段重试。
- 支持跳过。
- 支持用户手动完成后标记核对。

悬浮组件使用 Shadow DOM 降低样式冲突。

开发阶段优先保证调试便利性，生产阶段再决定是否使用 Closed Shadow DOM。

## 13.4 最终报告

系统必须输出：

```text
本次任务

已扫描字段：68
成功映射：64
已验证填写：61

需要人工处理：3
缺少简历数据：4

检测到用户修改：2
已保护用户修改：2

跨段错填：0
未确认提交字段：3

最终提交：未执行
```

所有统计均以真实执行记录为依据，不得通过估计填充数量或 DOM 输入框非空数量推断成功。

---

# 第十四章 五周敏捷开发执行计划（V2.1）

本章作为 AI 编码助手的主要执行依据。

五周计划以**核心执行引擎正确性**为第一优先级，不允许为了赶进度跳过关键验证。

## Week 1：工程底座、状态契约与最小填写闭环

### 阶段目标

完成轻量双包工程结构，打通基础通信，实现第一个真正具备提交验证的标准字段执行流程。

### 工作任务

| ID | 任务 | 核心交付物 | 优先级 |
|---|---|---|---|
| W1-01 | 初始化双包 Monorepo | `pnpm-workspace.yaml` | P0 |
| W1-02 | 初始化 WXT + React + TypeScript | `apps/extension` | P0 |
| W1-03 | 建立模块边界规则 | `eslint.config.js` | P0 |
| W1-04 | 实现三层 ResumeSchema | `src/resume/` | P0 |
| W1-05 | 实现基础消息契约 | `src/shared/messages/` | P0 |
| W1-06 | 实现 FieldIdentity 基础结构 | `src/identity/` | P0 |
| W1-07 | 实现 FieldGuard 与 WriteTransactionLease 最小版本 | `src/guard/` | P0 |
| W1-08 | 实现原生 Primitives | `src/actuator/Primitives.ts` | P0 |
| W1-09 | 实现基础 CommitPredicate | `src/verifier/CommitPredicate.ts` | P0 |
| W1-10 | 搭建 React/Vue 标准输入靶场 | `packages/testbed` | P0 |
| W1-11 | 建立首批 Vitest + Playwright | 自动回归测试 | P0 |
| W1-12 | 完成 SidePanel 最小任务控制界面 | 启动、取消、结果查看 | P0 |

### 本周实现范围

必须能够完成：

```text
简历 Schema
    ↓
扫描普通字段
    ↓
确定字段映射
    ↓
取得 WriteLease
    ↓
执行标准输入
    ↓
CommitPredicate
    ↓
释放租约
    ↓
输出状态
```

### 验收测试

必须覆盖：

- 原生文本输入。
- textarea。
- number。
- email。
- 原生 Select。
- Checkbox。
- Radio。
- React 受控输入。
- Vue 受控输入。
- 输入后失焦。
- React/Vue 重绘。
- 用户在执行期间接管。
- 任务取消后不继续执行。

### Week 1 完成标准

1. 工程构建通过。
2. ESLint 模块边界生效。
3. 标准字段可以成功填写并验证。
4. 用户接管机制最小版本正常工作。
5. 所有字段成功状态均由 CommitPredicate 决定。
6. Playwright 能在真实浏览器中加载编译后的扩展并执行测试。

**阶段门禁 G1：标准字段闭环验证通过。**

---

## Week 2：Repeater 拓扑、Content Witness 与字段重锚定

### 阶段目标

解决动态经历区块和 React DOM 重绘后的逻辑身份恢复问题。

### 工作任务

| ID | 任务 | 核心交付物 | 优先级 |
|---|---|---|---|
| W2-01 | 实现 SectionScanner | 经历区块识别 | P0 |
| W2-02 | 实现 RepeaterManager | 安全动态扩容 | P0 |
| W2-03 | 实现 FormInstanceRegistry | 实例身份管理 | P0 |
| W2-04 | 实现 ContentWitness | 内容证人提取 | P0 |
| W2-05 | 实现 DeterministicFieldKey | 字段复合键 | P0 |
| W2-06 | 实现 ReanchorManager | 实例和字段重锚定 | P0 |
| W2-07 | 实现 DOMRevisionTracker | DOM 版本感知 | P0 |
| W2-08 | 实现 Scoped FieldDistiller | 区块隔离扫描 | P0 |
| W2-09 | 实现 FastRuleMatcher | 本地字段语义路由 | P0 |
| W2-10 | 实现 ConstraintAwareFormatter | 格式约束适配 | P0 |
| W2-11 | 实现 FingerprintCache 基础版本 | ATS 映射缓存 | P1 |
| W2-12 | 实现 BatchLLMRouter 基础版本 | 未知字段指针路由 | P1 |

### 本周重点

必须完整实现：

```text
三段项目经历
      ↓
安全扩容
      ↓
建立实例绑定
      ↓
填充字段
      ↓
React 重绘
      ↓
ContentWitness
      ↓
ReanchorManager
      ↓
恢复 FieldGuard
```

### 验收测试

- 三段项目经历自动扩容。
- 三段教育经历自动扩容。
- 相同字段标签不串写。
- 删除中间经历不导致索引错位。
- 插入空白经历不影响原有绑定。
- React 整块重绘后正确恢复身份。
- 两段经历同名时不盲目绑定。
- 用户修改标题后仍然保护原字段。
- 字段身份不确定时触发人工确认。

### Week 2 完成标准

在规定回归测试中：

- 跨段错填为 0。
- 错误继承 FieldGuard 为 0。
- 无法确定身份时安全停止。
- 逻辑身份与 DOM 节点生命周期解耦。

**阶段门禁 G2：重锚定与跨段保护通过。**

---

## Week 3：三波次调度与复杂 Select 微代理

### 阶段目标

解决复杂下拉框的正式选中问题，以及页面联动导致的执行顺序冲突。

### 工作任务

| ID | 任务 | 核心交付物 | 优先级 |
|---|---|---|---|
| W3-01 | 实现 WaveClassifier | 字段波次分类 | P0 |
| W3-02 | 实现 WaveScheduler | 三波次调度 | P0 |
| W3-03 | 实现 WaveBarrier | 屏障与增量重扫 | P0 |
| W3-04 | 实现 RuntimeDependencyRegistry | 动态依赖记录 | P0 |
| W3-05 | 实现 ExecutionMutex | 全局浮层互斥 | P0 |
| W3-06 | 实现 PortalTracker | 浮层定位 | P0 |
| W3-07 | 实现 SelectAgent | 自定义下拉框 | P0 |
| W3-08 | 实现 Search-First | 搜索型选项定位 | P0 |
| W3-09 | 实现 CascaderWalker | 多级联动 | P0 |
| W3-10 | 实现复杂组件 CommitPredicate | 提交状态验证 | P0 |
| W3-11 | 实现异常动作预算 | 无进展熔断 | P0 |
| W3-12 | 建立北森月份专项回归 | 旧版失败复现测试 | P0 |

### 本周重点

完整跑通：

```text
Wave 1：结构控制字段
          ↓
       Barrier
          ↓
Wave 2：复杂 Select
          ↓
       Barrier
          ↓
Wave 3：普通文本
          ↓
      DirtyChecker
```

### 必须重点测试

**北森年月下拉框：**

```text
目标值：2026 年 1 月
```

系统必须：

1. 正确打开年份选择器。
2. 正式选中 2026。
3. 正确打开月份选择器。
4. 输入或检索月份 1。
5. 在 `1、10、11、12` 中精确选择 `1`。
6. 确认组件提交了月份值。
7. 重新读取并验证年月。
8. 页面重绘后再次确认。

如果只是搜索框显示 `1`，不得报告成功。

### Week 3 完成标准

- 已知复杂 Select 正式选中验证通过。
- Portal 浮层定位正确。
- 相似选项不会错误匹配。
- 三波次屏障能够处理已知字段联动。
- 发现未知联动时能够重新扫描或降级。
- 不出现多个慢路径同时操作同一浮层。

**阶段门禁 G3：复杂 Select 和三波次调度通过。**

---

## Week 4：DateAgent、跨域 Frame 与 SPA 恢复

### 阶段目标

实现复杂日期和跨页面生命周期的可靠执行。

### 工作任务

| ID | 任务 | 核心交付物 | 优先级 |
|---|---|---|---|
| W4-01 | 实现 DateAgent | 日期专用状态机 | P0 |
| W4-02 | 实现年月日视图分类 | 日期组件分类器 | P0 |
| W4-03 | 实现日期翻页与进展检测 | 有界日期导航 | P0 |
| W4-04 | 实现 DateRange 适配 | 日期范围处理 | P0 |
| W4-05 | 实现 FrameRegistry | 跨 Frame 注册 | P0 |
| W4-06 | 实现 TabCoordinator | 全局任务协调 | P0 |
| W4-07 | 实现跨帧执行许可 | 跨 Frame 互斥 | P0 |
| W4-08 | 实现 SPA StepObserver | 路由和 DOM 切换感知 | P0 |
| W4-09 | 实现 SessionStore | Service Worker 恢复 | P0 |
| W4-10 | 完善 AbortController 执行链 | 全局取消 | P0 |
| W4-11 | 实现 FileUploadAgent 基础版本 | 附件辅助上传 | P1 |

### 本周重点

包括：

```text
异构日期
+
跨域 iframe
+
SPA 多步骤
+
后台任务恢复
```

必须保证：

- iframe 重建后旧 Frame 任务失效。
- Service Worker 重启后不重放过期动作。
- 日期翻页有进展时继续，没有进展时停止。
- 用户取消后旧异步回调不能继续点击。
- 页面切换后重新建立字段身份。
- 附件上传失败能转人工处理。

### Week 4 完成标准

核心跨页面执行和复杂日期测试通过。

**阶段门禁 G4：生命周期、日期和跨帧安全通过。**

---

## Week 5：终态验证、人工接管与真实 ATS 回归

### 阶段目标

完成真实可用的自动填写插件 Beta 版本。

### 工作任务

| ID | 任务 | 核心交付物 | 优先级 |
|---|---|---|---|
| W5-01 | 完善 DirtyChecker | 整页终态复检 | P0 |
| W5-02 | 完善 RecoveryPlanner | 有界失败恢复 | P0 |
| W5-03 | 实现 QuickFillPill | 悬浮人工接管 | P0 |
| W5-04 | 实现完整 SidePanel 进度报告 | 字段状态可视化 | P0 |
| W5-05 | 完善 UserInteractionObserver | 用户覆盖保护 | P0 |
| W5-06 | 实现 MappingMemory | 已验证映射记忆 | P1 |
| W5-07 | 实现 JD Sniffer | 岗位描述缓存 | P1 |
| W5-08 | 实现 EssayGenerator | 主观题草稿生成 | P2 |
| W5-09 | 完成 25 类核心控件回归 | 自动化测试 | P0 |
| W5-10 | 完成 PATCH-01/02/04 专项回归 | 工程补丁验收 | P0 |
| W5-11 | 完成真实 ATS 测试 | 实战测试报告 | P0 |
| W5-12 | 隐私审计与扩展打包 | ZIP / 构建产物 | P0 |

### 真实 ATS 测试计划

| ATS 系统 | 目标测试入口数 | 重点 |
|---|---:|---|
| 北森 | 3 | Phoenix、年月、经历扩容 |
| Moka | 3 | 自定义 Select、动态表单 |
| 飞书招聘 | 3 | UD 组件、受控输入 |
| Greenhouse | 2 | 标准字段、iframe |
| Workday | 2 | SPA、多步骤流程 |
| 其他企业自研系统 | 2 | 未知组件、人工接管 |
| **合计** | **15** | 完整自动填写流程 |

应优先选择可以合法测试且不需要执行真实最终投递的页面。

未取得测试权限或无法访问的真实站点，需要如实记录，不得用静态截图代替成功验收。

### Week 5 完成标准

最终系统具备：

- 完整结构化简历管理。
- 表单拓扑识别。
- 字段语义匹配。
- Repeater 动态扩容。
- 逻辑身份重锚定。
- 三波次执行调度。
- 常见复杂组件交互。
- 日期状态机。
- WriteTransactionLease。
- CommitPredicate。
- 终态 DirtyChecker。
- 人工接管。
- 任务取消。
- 隐私控制。
- 自动化回归测试。
- 可安装构建。

**阶段门禁 G5：核心 P0 验收全部通过。**

若五周结束时 G1—G5 尚未全部通过，应如实标记 Beta 状态和未完成项，不允许只依据时间节点宣布达到生产级质量。

---

# 第十五章 自动化测试与故障注入

## 15.1 测试架构

采用：

```text
Unit Tests
    ↓
Component Tests
    ↓
Integration Tests
    ↓
Browser E2E Tests
    ↓
Real ATS Regression
```

测试框架：

- Vitest。
- Playwright。
- React 18。
- Vue 3。
- Ant Design 5。
- MUI。
- Element Plus。

所有浏览器 E2E 必须使用真实编译后的扩展执行关键路径。

不能只在普通网页上下文中模拟 Content Script。

## 15.2 核心 25 类控件测试

| ID | 测试场景 | 关键断言 |
|---|---|---|
| T01 | 原生文本输入 | 值正确 |
| T02 | React 受控输入 | 框架状态同步 |
| T03 | Vue 受控输入 | 框架状态同步 |
| T04 | 原生 Select | 正确提交 |
| T05 | 自定义 Select | 正式选择成功 |
| T06 | 搜索型 Select | 搜索与提交分离 |
| T07 | 相似候选项 | 精确消歧 |
| T08 | Portal 浮层 | 正确定位 |
| T09 | 预挂载浮层 | 可见性识别 |
| T10 | 虚拟滚动列表 | 目标选项定位 |
| T11 | 异步候选项 | 等待正确完成 |
| T12 | 三级 Cascader | 层级路径一致 |
| T13 | 原生日期 | 日期正确 |
| T14 | 年月双下拉 | 两字段正式提交 |
| T15 | 年月日组件 | 目标日期一致 |
| T16 | 日期范围 | 起止日期一致 |
| T17 | 日期无进展 | 有限熔断 |
| T18 | Repeater 扩容 | 实例数量正确 |
| T19 | 多段经历 | 不跨段 |
| T20 | DOM 重绘重锚定 | 身份正确恢复 |
| T21 | 用户输入接管 | Agent 停止覆盖 |
| T22 | SPA 路由切换 | 状态恢复正确 |
| T23 | 跨域 iframe | 正确执行或报告权限问题 |
| T24 | 文件上传 | 真实状态验证或人工兜底 |
| T25 | 假成功与回滚 | 正确检测失败 |

## 15.3 V2.1 新增专项测试

除上述 25 类测试外，必须增加三个专项测试套件。

### Suite A：Reanchor Regression

覆盖：

- 节点销毁重建。
- 项目插入和删除。
- 重复项目名称。
- 用户修改内容证人。
- 同名字段顺序变化。
- 模糊身份拒绝。
- FieldGuard 继承正确性。

### Suite B：Wave Scheduling Regression

覆盖：

- 学历影响专业。
- 省份影响城市。
- 日期联动。
- 动态显示条件字段。
- 文本输入引发联动。
- Wave 屏障超时。
- 动态降级串行。
- 中途取消。

### Suite C：Write Transaction Regression

覆盖：

- 用户按键接管。
- 鼠标点击接管。
- 粘贴。
- 输入法组合输入。
- 页面脚本 focus。
- Agent 同步写入竞争。
- 异步等待被取消。
- 租约过期。
- DOM 重绘。
- 旧事务延迟返回。
- 重复释放租约。

## 15.4 故障注入要求

必须主动模拟：

| 故障 | 预期系统行为 |
|---|---|
| 目标字段突然消失 | 重新绑定或停止 |
| React 重绘整个区块 | ReanchorManager 恢复 |
| 两个经历名称相同 | 歧义保护 |
| 选择器点击无响应 | 有界重试 |
| 搜索框填入但未选中 | CommitPredicate 拒绝成功 |
| Portal 未出现 | 超时熔断 |
| 日期 Header 不变化 | 无进展熔断 |
| Repeater 添加失败 | 不无限点击 |
| 用户输入中断 Agent | 撤销租约 |
| 旧任务异步返回 | 忽略过期结果 |
| Service Worker 重启 | 恢复后重新验证 |
| iframe 销毁 | 终止对应 Frame 任务 |
| 页面字段联动清空 | 有界复检和补填 |
| LLM 返回错误 JSON Path | 本地校验拒绝 |
| 文件上传不被接受 | 转人工 |
| 网页包含恶意提示内容 | 不执行网页中的模型指令 |

---

# 第十六章 工程风险矩阵

| 级别 | 风险 | V2.1 防御机制 |
|---|---|---|
| P0 | 重锚定错误导致用户锁继承错位 | 多证据匹配、冲突检测、歧义保护 |
| P0 | 重复经历跨段串写 | FormInstanceId + Scoped Field |
| P0 | 用户输入被覆盖 | WriteTransactionLease |
| P0 | Agent 取消后继续点击 | AbortController + 版本校验 |
| P0 | 下拉框假成功 | CommitPredicate |
| P0 | 普通字段被上游联动清空 | 三波次屏障 + DirtyChecker |
| P0 | 无限点击或重试 | 动作预算 + 无进展预算 |
| P0 | React/Vue 重绘导致旧节点失效 | DOMRevision + ReanchorManager |
| P0 | LLM 错误映射敏感字段 | 本地 Schema 校验 + 人工确认 |
| P0 | 简历个人数据意外外发 | Local-Only 隐私边界 |
| P0 | 插件错误触发最终投递 | 最终提交禁止策略 |
| P1 | iframe 无权限 | 权限申请 + 人工接管 |
| P1 | ATS 缓存过期 | 结构版本和语义复核 |
| P1 | Portal 定位错误 | 浮层差分与空间关联 |
| P1 | 文本字段也触发联动 | 运行时依赖记录与串行降级 |
| P1 | 日期跨度较大 | 动态执行预算 |
| P1 | 文件上传接口不兼容 | 验证与人工兜底 |
| P1 | Service Worker 状态丢失 | SessionStore + 重新验证 |
| P1 | Shadow DOM 不可访问 | 明确受限状态 |
| P1 | 自动学习污染缓存 | 仅保存已验证映射 |
| P2 | 工作台功能过多影响工期 | P0 优先，P2 延后 |
| P2 | 插件 UI 样式冲突 | Shadow DOM + 回归测试 |

### P0 处理要求

一旦发现 P0 问题：

1. 停止受影响执行链。
2. 保留脱敏执行证据。
3. 标记准确失败状态。
4. 创建最小可复现用例。
5. 修复底层逻辑。
6. 增加自动化回归。
7. 确认未引入新的跨组件问题。

禁止通过跳过验证、增加大量固定等待或强制标记成功来掩盖 P0 问题。

---

# 第十七章 AI 编码助手执行规范

## 17.1 总体要求

AI 编码助手必须以本任务书作为工程基线。

开发时优先保证：

```text
Correctness
    ↓
Safety
    ↓
Reliability
    ↓
Maintainability
    ↓
Performance
```

即：

**正确性 → 安全性 → 可靠性 → 可维护性 → 性能。**

## 17.2 禁止行为

AI 编码助手不得：

1. 未检查现有代码就大范围重构。
2. 绕过统一 FieldExecutionEngine。
3. 绕过 CommitPredicate 标记成功。
4. 删除失败断言以使 CI 通过。
5. 使用固定 `sleep` 代替状态验证。
6. 仅依赖 CSS 类名识别组件。
7. 使用 `nth-child` 作为唯一字段身份。
8. 仅根据内容证人直接恢复历史 FieldGuard。
9. 假设所有文本框均无联动副作用。
10. 通过 `isTrusted` 单独判断全部用户修改。
11. 忽略 AbortSignal 继续执行动作。
12. 自动重放失败点击而不重新验证页面。
13. 为了提高成功率绕过浏览器权限。
14. 未经用户授权上传个人简历。
15. 自动点击最终投递按钮。
16. 将真实 API Key、个人资料或测试账号凭据提交到仓库。
17. 以 Mock 成功代替真实组件测试。
18. 在没有证据时宣称已通过真实 ATS 验收。

## 17.3 每次开发任务的执行流程

```text
读取任务书
      ↓
确定对应模块和接口
      ↓
检查已有代码
      ↓
定义验收测试
      ↓
实现最小改动
      ↓
运行单元测试
      ↓
运行相关 E2E
      ↓
检查架构边界
      ↓
记录变更
      ↓
报告完成状态
```

## 17.4 任务完成报告

统一格式：

```text
任务编号：
任务名称：

一、实现内容
- 修改文件
- 新增模块
- 关键算法
- 接口变化

二、测试结果
- 通过测试
- 失败测试
- 未运行测试

三、实际验证范围
- 本地单元测试
- React/Vue 动态靶场
- 真实 ATS 测试

四、已知问题
- 未支持组件
- 当前限制
- 潜在风险

五、验收结论
PASS / PARTIAL / FAIL

六、下一步依赖
- 尚待完成的模块
- 可能影响后续开发的问题
```

不得用“已完成代码编写”代替验收通过。

---

# 第十八章 最终交付物与项目完成标准

## 18.1 代码交付

必须包含：

| 交付物 | 要求 |
|---|---|
| 完整源码 | TypeScript，架构清晰 |
| 双包 Monorepo | Extension + Testbed |
| Chrome 安装包 | ZIP / 可加载构建 |
| Edge 兼容版本 | 完成基本兼容验证 |
| 三层 ResumeSchema | 支持事实与派生切面 |
| ReanchorManager | 支持确定性重锚定与歧义保护 |
| WaveScheduler | 三波次屏障执行 |
| WriteTransactionLease | 用户接管保护 |
| CommitPredicate | 组件正式提交验证 |
| SelectAgent | 复杂下拉组件 |
| CascaderWalker | 多级级联 |
| DateAgent | 异构日期 |
| DirtyChecker | 终态验证 |
| QuickFillPill | 人工接管 |
| ATS Fingerprint Cache | 已验证映射复用 |
| Playwright Testbed | 动态组件回归 |
| GitHub Actions | 自动测试与构建 |
| 工程文档 | 架构、接口、算法、隐私 |
| 测试报告 | 性能、准确率、覆盖率及失败情况 |

## 18.2 五大验收门禁

### Gate 1：字段提交正确性

- 标准输入框提交正确。
- React/Vue 受控状态正确。
- 搜索型 Select 正式选中。
- 日期组件结果正确。
- 假成功用例全部识别。

### Gate 2：身份和用户保护

- Repeater 不跨段。
- React 重绘后逻辑身份正确。
- 同名项目不错误绑定。
- 用户修改保护不丢失。
- 已撤销租约不产生新写入。

### Gate 3：执行安全

- 三波次调度正确。
- 未知依赖能够降级。
- 所有异常有限终止。
- 取消后不继续执行。
- 不自动最终提交。

### Gate 4：网页生命周期

- 跨域 iframe 正确处理。
- SPA 步骤切换正确处理。
- Frame 销毁后任务失效。
- Service Worker 重启后安全恢复。
- DOM 节点失效后重新定位。

### Gate 5：完整产品可用性

- Workbench 可管理简历。
- SidePanel 可控制任务。
- 失败字段可人工接管。
- 缓存能够安全复用。
- 核心自动化回归通过。
- 真实 ATS 测试完成并形成报告。
- 可生成安装包。

## 18.3 推荐最终验收场景

使用一份包含以下内容的结构化简历：

```text
个人基本信息
    ├── 姓名
    ├── 电话
    └── 邮箱

教育经历
    ├── 本科
    └── 硕士

项目经历
    ├── 项目 A
    ├── 项目 B
    └── 项目 C

技能证书

PDF 简历附件

开放式问答
```

目标招聘表单包含：

```text
Step 1：基本信息
Step 2：教育经历
Step 3：项目经历
Step 4：补充信息
Step 5：附件与确认
```

系统应完成：

1. 自动识别字段。
2. 匹配简历数据。
3. 动态扩容经历区块。
4. 正确填写三段经历。
5. 完成自定义下拉选项选择。
6. 完成异构年月填写。
7. 执行正确的字段依赖顺序。
8. 在 SPA 切换后恢复工作。
9. 在 React 重绘后恢复逻辑身份。
10. 在用户接管时停止相应自动操作。
11. 验证最终字段状态。
12. 对失败项提供人工接管。
13. 输出可追溯的结果报告。
14. 保留最终投递操作由用户自己完成。

---

# 第十九章 项目执行基线与版本管理

## 19.1 版本范围

### V2.1 MVP 必须实现

- 双包 Monorepo。
- 三层 ResumeSchema。
- 字段语义规则路由。
- 标准控件执行。
- 逻辑身份与重锚定。
- 三波次调度。
- WriteTransactionLease。
- SelectAgent。
- CascaderWalker。
- DateAgent。
- CommitPredicate。
- DirtyChecker。
- 用户人工接管。
- 基础自动化回归。

### V2.1 Beta 扩展

- 跨域 iframe 协同。
- SPA 多步骤处理。
- Service Worker 安全恢复。
- ATS 模板指纹缓存。
- LLM 指针路由。
- FileUploadAgent。
- 基础 JD 嗅探。

### 后续增强能力

- 更多 ATS 专用适配器。
- 跨网站控件经验复用。
- 更完善的主观题生成。
- 多简历版本智能选择。
- 可信度校准。
- 更丰富的执行可视化。
- 可选实验性 CDP 增强。

后续增强功能不能成为核心 P0 验收的前置依赖。

## 19.2 版本冻结原则

V2.1 冻结以下接口方向：

```text
ResumeSchema
      ↓
FieldSignature
      ↓
FieldIdentity
      ↓
FieldExecutionPlan
      ↓
WaveScheduler
      ↓
WriteTransactionLease
      ↓
FieldExecutionEngine
      ↓
CommitPredicate
      ↓
FieldExecutionResult
```

允许优化算法实现，但修改公共契约时必须：

1. 说明修改理由。
2. 检查所有调用方。
3. 更新类型定义。
4. 更新相关测试。
5. 完成回归验证。
6. 记录版本变化。

不得在开发过程中频繁推翻核心架构。

---

# 第二十章 最终技术路线与执行结论

ApplyFill 2.0 的核心不再是“利用 AI 模拟人类点击网页”。

最终技术路线确定为：

**第一层：Resume Intelligence**

负责简历事实、结构化数据和不同表单适配切面。

**第二层：Form Intelligence**

负责表单拓扑、Repeater、字段身份、重锚定及语义映射。

**第三层：Interaction Intelligence**

负责三波次调度、专用控件状态机、写入租约、提交验证及失败恢复。

整体流程：

```text
          Resume Intelligence
                  │
                  ▼
          离线三层简历知识库
                  │
                  ▼
            Form Intelligence
                  │
          两阶段表单拓扑感知
                  │
          Content Witness 重锚定
                  │
          分层语义指针路由
                  │
                  ▼
         Interaction Intelligence
                  │
          三波次屏障调度
                  │
          WriteTransactionLease
                  │
          专用控件执行状态机
                  │
          CommitPredicate 验证
                  │
          DirtyChecker 终态复检
                  │
          人工接管 / 有界恢复
                  │
                  ▼
            Verified Result
```

## 最终开发原则

**一、先解决字段身份，再解决字段执行。**

如果不知道当前控件究竟属于哪段经历，再强大的自动点击能力也可能把数据填错。

**二、先确定执行顺序，再优化填写速度。**

三波次屏障调度是默认低成本方案，动态依赖修正和终态复检负责处理例外。

**三、先保护用户输入，再追求全自动。**

一旦用户开始编辑，Agent 必须让出对应字段的控制权。

**四、先建立正式提交判据，再宣布填写成功。**

搜索框出现文本、下拉浮层关闭或 DOM 值变化，都不能独立代表组件已经接受目标值。

**五、先完成通用状态机，再增加 ATS 专用适配。**

特殊网站适配器必须复用统一执行与验证机制，不能绕过核心安全契约。

**六、先完成自动化回归，再开展大规模真实站点测试。**

每次修复一个历史问题，都必须将其转化为可重复执行的测试用例。

**七、保持工程轻量，但不牺牲必要的模块边界。**

使用两个物理包、统一类型契约和 ESLint 单向依赖规则，避免不必要的 Monorepo 复杂度。

---
