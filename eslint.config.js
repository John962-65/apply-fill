import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SRC = './apps/extension/src';

const zone = (target, from, message) => ({ target, from: from.includes('{') ? `${from}/**/*` : from, message });

const boundaryZones = [
  zone(
    `${SRC}/shared`,
    `${SRC}/{guard,resume,formatter,perceptor,identity,router,scheduler,actuator,verifier,runtime,ui,background,jd,memory}`,
    'shared 是最底层契约，不得依赖任何业务模块',
  ),
  zone(
    `${SRC}/guard`,
    `${SRC}/{resume,formatter,perceptor,identity,router,scheduler,actuator,verifier,runtime,ui,background,jd,memory}`,
    'guard 只能依赖 shared',
  ),
  zone(
    `${SRC}/resume`,
    `${SRC}/{guard,formatter,perceptor,identity,router,scheduler,actuator,verifier,runtime,ui,background,jd,memory}`,
    'resume 不得依赖执行层模块，且不得依赖 DOM',
  ),
  zone(
    `${SRC}/formatter`,
    `${SRC}/{guard,perceptor,identity,router,scheduler,actuator,verifier,runtime,ui,background,jd,memory}`,
    'formatter 不得依赖浏览器运行环境与执行层模块',
  ),
  zone(
    `${SRC}/identity`,
    `${SRC}/{guard,resume,formatter,perceptor,router,scheduler,actuator,verifier,runtime,ui,background,jd,memory}`,
    'identity 只能依赖 shared（identity 不得导入 scheduler）',
  ),
  zone(
    `${SRC}/perceptor`,
    `${SRC}/{guard,formatter,identity,router,scheduler,actuator,verifier,runtime,ui,background,jd,memory}`,
    'perceptor 不得导入 actuator 等高阶执行模块',
  ),
  zone(
    `${SRC}/router`,
    `${SRC}/{guard,formatter,perceptor,identity,scheduler,actuator,verifier,runtime,ui,background,jd,memory}`,
    'router 不得导入 actuator 等高阶执行模块',
  ),
  zone(
    `${SRC}/scheduler`,
    `${SRC}/{actuator,verifier,runtime,ui,background,jd,memory}`,
    'scheduler 通过共享接口调用执行能力，不得直接依赖具体执行实现',
  ),
  zone(
    `${SRC}/actuator`,
    `${SRC}/{scheduler,verifier,runtime,ui,background,jd,memory}`,
    'actuator 不得依赖调度器、验证器与 UI',
  ),
  zone(
    `${SRC}/verifier`,
    `${SRC}/{runtime,ui,background,jd,memory}`,
    'verifier 不得反向控制上层编排与 UI',
  ),
  zone(
    `${SRC}/runtime`,
    `${SRC}/{ui,background}`,
    'runtime orchestration 不得依赖 UI 与 Background 具体实现',
  ),
  zone(
    `${SRC}/background`,
    `${SRC}/ui`,
    'background 不得导入 React UI 组件',
  ),
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/dist/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/.venv/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'import-x': importX,
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          project: ['apps/extension/tsconfig.json', 'packages/testbed/tsconfig.json'],
        },
        node: true,
      },
    },
    rules: {
      'import-x/no-cycle': ['error', { maxDepth: 6, ignoreExternal: true }],
      'import-x/no-restricted-paths': ['error', { zones: boundaryZones }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },
  {
    files: ['apps/extension/src/resume/**/*.ts', 'apps/extension/src/formatter/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'location',
        'HTMLElement',
        'customElements',
        'localStorage',
        'sessionStorage',
      ],
    },
  },
  {
    files: ['apps/extension/src/resume/storage/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'import-x/no-restricted-paths': 'off',
    },
  },
);
