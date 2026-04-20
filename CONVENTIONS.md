# Editrix 编码规范

本文档定义 Editrix 项目的 TypeScript 编码标准。所有贡献者必须遵守。
ESLint 自动检查的规则用 `[lint]` 标记，需人工遵守的用 `[review]` 标记。

---

## 1. 语言与编译

| 规则                 | 说明                                    |
| -------------------- | --------------------------------------- |
| TypeScript 版本      | ≥ 5.7，使用 ES2022 目标                 |
| 模块系统             | ESM only (`"type": "module"`)           |
| 严格模式             | `strict: true` + 所有额外严格选项均开启 |
| Import 后缀          | 所有相对导入必须带 `.js` 后缀 `[lint]`  |
| verbatimModuleSyntax | 启用，强制 `import type` 分离 `[lint]`  |

---

## 2. 命名约定

### 2.1 文件命名 `[review]`

```
kebab-case.ts       ✓ service-registry.ts
PascalCase.ts       ✗ ServiceRegistry.ts
camelCase.ts        ✗ serviceRegistry.ts
```

- 每个文件导出一个主要概念（接口 + 实现算一个）
- 测试文件：`__tests__/<被测文件名>.test.ts`

### 2.2 标识符命名

| 类型              | 格式                     | 示例                                                  | 检查       |
| ----------------- | ------------------------ | ----------------------------------------------------- | ---------- |
| 接口（服务/行为） | `I` + PascalCase         | `IServiceRegistry`, `IKernel`                         | `[review]` |
| 接口（数据/内部） | PascalCase               | `PluginEntry`, `ServiceEntry`                         | `[lint]`   |
| 类型别名          | PascalCase               | `Event<T>`, `StepResult`                              | `[lint]`   |
| 品牌类型          | PascalCase               | `ServiceIdentifier<T>`                                | `[lint]`   |
| 类                | PascalCase               | `EventBus`, `Emitter<T>`                              | `[lint]`   |
| 枚举              | PascalCase               | `PluginState`, `ServiceScope`                         | `[lint]`   |
| 枚举成员          | PascalCase               | `PluginState.Active`                                  | `[lint]`   |
| 函数              | camelCase                | `createKernel()`                                      | `[lint]`   |
| 变量              | camelCase / UPPER_CASE   | `const result`, `const MAX_RETRIES`                   | `[lint]`   |
| 服务 ID 常量      | PascalCase（与接口同名） | `const ILogger = createServiceId<ILogger>('ILogger')` | `[lint]`   |
| 私有成员          | `_` + camelCase          | `private _listeners`                                  | `[lint]`   |
| 参数              | camelCase                | `pluginId`, `eventId`                                 | `[lint]`   |

### 2.3 `I` 前缀规则 `[review]`

**使用 `I` 前缀的场景：**

- 定义服务合约（消费者依赖的抽象）：`IKernel`, `IServiceRegistry`, `IEventBus`
- 定义插件上下文：`IPlugin`, `IPluginContext`
- 可被外部替换/mock 的接口

**不使用 `I` 前缀的场景：**

- 数据结构 / DTO：`PluginEntry`, `ServiceEntry`
- 品牌类型：`ServiceIdentifier<T>`, `ExtensionPointId<T>`
- 函数类型别名：`Event<T>`

---

## 3. Import 规范

### 3.1 导入顺序 `[lint]`

```typescript
// 1. Node.js 内置模块
import { readFile } from 'node:fs/promises';
// 2. 外部依赖
import type { Event } from '@editrix/common';
import { Emitter } from '@editrix/common';
// 3. 内部模块（同包的其他文件）
import type { IServiceRegistry } from './service-registry.js';
import { ServiceRegistry } from './service-registry.js';
```

- 同一分组内按字母序排列
- 分组之间**不加空行**（与 Prettier 兼容）

### 3.2 类型导入 `[lint]`

```typescript
// ✓ 纯类型导入单独一行
import type { IDisposable, ServiceIdentifier } from '@editrix/common';
import { Emitter, toDisposable } from '@editrix/common';

// ✗ 不要混合类型和值导入
import { type IDisposable, Emitter } from '@editrix/common';
```

使用 `separate-type-imports` 风格：类型和值导入分开写。

### 3.3 导出 `[lint]`

```typescript
// ✓ 类型导出也需要 export type
export type { IKernel } from './kernel.js';
export { createKernel } from './kernel.js';
```

---

## 4. 注释规范

### 4.1 JSDoc — 何时写 `[review]`

**必须写 JSDoc 的：**

- 所有 `export` 的接口、类型、类、函数
- 接口的每个方法/属性
- 复杂的业务逻辑

**不需要 JSDoc 的：**

- 私有实现细节（名字已自解释的）
- 测试代码
- 类型已经完全自解释的简单 getter/setter

### 4.2 JSDoc 格式 `[review]`

````typescript
/**
 * 一句话描述做什么（必须）。
 *
 * 详细说明为什么这样设计、有什么限制（可选，复杂情况才写）。
 *
 * @example
 * ```ts
 * const kernel = createKernel();
 * await kernel.start();
 * ```
 */
````

规则：

- 第一行是摘要，以句号结尾
- 摘要和详情之间空一行
- 用 `@example` 展示用法（公共 API 必须有）
- 不写 `@param` / `@returns`（类型签名已经说明了），除非需要额外说明语义
- 不写 `@author`、`@since`、`@date`

### 4.3 行内注释 `[review]`

```typescript
// ✓ 解释"为什么"，不解释"是什么"
// Wildcard listeners need to be checked against every event emission
for (const [pattern, handlers] of this._wildcards) { ... }

// ✗ 不要复述代码
// Loop through wildcards
for (const [pattern, handlers] of this._wildcards) { ... }
```

- 使用 `//`，不使用 `/* */`（多行注释除外）
- 注释与代码之间空一行（不要紧贴在代码后面）
- TODO 格式：`// TODO(用户名): 描述`

---

## 5. 代码风格

### 5.1 格式化 — Prettier `[lint]`

| 规则   | 值     |
| ------ | ------ |
| 分号   | 总是   |
| 引号   | 单引号 |
| 尾逗号 | 总是   |
| 行宽   | 100    |
| 缩进   | 2 空格 |

### 5.2 类结构 `[review]`

```typescript
class MyClass implements IMyInterface {
  // 1. 静态成员
  static readonly MAX_SIZE = 100;

  // 2. 私有字段（readonly 优先）
  private readonly _store = new Map<string, unknown>();
  private _count = 0;

  // 3. 公共只读属性
  readonly name: string;

  // 4. 构造函数
  constructor(name: string) {
    this.name = name;
  }

  // 5. 公共方法（接口方法的实现）
  get(key: string): unknown { ... }

  // 6. 私有方法
  private _validate(key: string): boolean { ... }

  // 7. dispose 方法（总是最后）
  dispose(): void { ... }
}
```

### 5.3 函数 `[lint]`

- 公开函数必须有显式返回类型 `[lint]`
- 参数超过 3 个时换行，每个参数一行
- 不使用 `arguments`，用 rest 参数
- 优先用箭头函数做回调

### 5.4 错误处理 `[review]`

```typescript
// ✓ 使用 Error cause 链
try {
  await plugin.activate(context);
} catch (cause) {
  throw new Error(`Plugin "${id}" failed to activate.`, { cause });
}

// ✗ 不要丢失原始错误
try {
  await plugin.activate(context);
} catch (err) {
  throw new Error(`Plugin "${id}" failed: ${err}`);
}
```

- 抛出的永远是 `Error` 实例，不是字符串
- 用 `{ cause }` 传递错误链
- 不要 catch 后忽略（除非有充分理由并加注释）

---

## 6. 架构约束

### 6.1 不可变性 `[review]`

- 公共 API 返回 `readonly` 数组和 `Readonly<Record>`
- 内部状态优先使用 `readonly` 修饰符
- 文档节点、状态等核心数据结构必须不可变

### 6.2 依赖方向 `[review]`

```
common ← core ← 其他所有包
```

- `common` 零依赖
- `core` 只依赖 `common`
- 禁止循环依赖
- 包之间通过接口解耦，不直接依赖实现

### 6.3 Disposable 模式 `[review]`

- 所有持有资源的对象实现 `IDisposable`
- 使用 `DisposableStore` 管理生命周期
- 插件在 `ctx.subscriptions` 中注册所有订阅

### 6.4 禁止项 `[lint]` / `[review]`

| 禁止                  | 原因                                           |
| --------------------- | ---------------------------------------------- |
| `any`                 | 使用 `unknown` + 类型守卫 `[lint]`             |
| `console.log`         | 使用框架日志系统 `[lint]`                      |
| `eval` / `Function()` | 安全风险 `[lint]`                              |
| `require()`           | ESM only `[lint]`                              |
| 装饰器                | 不用 `reflect-metadata`，保持零依赖 `[review]` |
| 类继承 > 2 层         | 优先组合 `[review]`                            |
| 循环引用              | 重构为单向依赖 `[review]`                      |

---

## 7. 测试规范

### 7.1 结构

```
packages/<pkg>/__tests__/<file>.test.ts
```

### 7.2 命名

```typescript
describe('ServiceRegistry', () => {
  it('should throw when resolving unregistered service', () => { ... });
  it('should return the registered instance', () => { ... });
});
```

- `describe` 用被测类/函数名
- `it` 用 `should + 动词` 描述期望行为

### 7.3 原则 `[review]`

- 每个测试只验证一个行为
- 不 mock 框架内部，只 mock 外部边界
- 测试文件可以放宽部分 lint 规则（见 ESLint 配置）
- 覆盖率目标：核心包 ≥ 90%

---

## 8. Git 规范

### 8.1 提交信息

```
<type>(<scope>): <subject>

<body>
```

type: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`
scope: 包名（`common`, `core`, `document` 等）

示例：

```
feat(core): add lazy plugin activation via activationEvents

Plugins can now declare activationEvents in their descriptor.
The kernel monitors events and activates matching plugins on demand.
```

### 8.2 分支

- `main` — 稳定版
- `feat/<name>` — 功能分支
- `fix/<name>` — 修复分支
