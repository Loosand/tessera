---
name: typescript-advanced-types
description: 掌握 TypeScript 高级类型系统，包括泛型、条件类型、映射类型、模板字面量类型和工具类型，用于构建类型安全的应用程序。在实现复杂类型逻辑、创建可复用类型工具或确保 TypeScript 项目的编译时类型安全时使用。
---

# TypeScript 高级类型

全面掌握 TypeScript 高级类型系统的指南，包括泛型、条件类型、映射类型、模板字面量类型和工具类型，用于构建健壮、类型安全的应用程序。

## 何时使用此技能

- 构建类型安全的库或框架
- 创建可复用的泛型组件
- 实现复杂的类型推断逻辑
- 设计类型安全的 API 客户端
- 构建表单验证系统
- 创建强类型配置对象
- 实现类型安全的状态管理
- 将 JavaScript 代码库迁移到 TypeScript

## 核心概念

### 1. 泛型

**目的：** 创建可复用、类型灵活的组件，同时保持类型安全。

**基础泛型函数：**

```typescript
function identity<T>(value: T): T {
  return value;
}

const num = identity<number>(42); // 类型: number
const str = identity<string>("hello"); // 类型: string
const auto = identity(true); // 类型推断: boolean
```

**泛型约束：**

```typescript
type HasLength = {
  length: number;
};

function logLength<T extends HasLength>(item: T): T {
  console.log(item.length);
  return item;
}

logLength("hello"); // OK: string 有 length 属性
logLength([1, 2, 3]); // OK: 数组有 length 属性
logLength({ length: 10 }); // OK: 对象有 length 属性
// logLength(42);             // 错误: number 没有 length 属性
```

**多个类型参数：**

```typescript
function merge<T, U>(obj1: T, obj2: U): T & U {
  return { ...obj1, ...obj2 };
}

const merged = merge({ name: "John" }, { age: 30 });
// 类型: { name: string } & { age: number }
```

### 2. 条件类型

**目的：** 创建依赖于条件的类型，实现复杂的类型逻辑。

**基础条件类型：**

```typescript
type IsString<T> = T extends string ? true : false;

type A = IsString<string>; // true
type B = IsString<number>; // false
```

**提取返回类型：**

```typescript
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

function getUser() {
  return { id: 1, name: "John" };
}

type User = ReturnType<typeof getUser>;
// 类型: { id: number; name: string; }
```

**分布式条件类型：**

```typescript
type ToArray<T> = T extends any ? T[] : never;

type StrOrNumArray = ToArray<string | number>;
// 类型: string[] | number[]
```

**嵌套条件：**

```typescript
type TypeName<T> = T extends string
  ? "string"
  : T extends number
    ? "number"
    : T extends boolean
      ? "boolean"
      : T extends undefined
        ? "undefined"
        : T extends Function
          ? "function"
          : "object";

type T1 = TypeName<string>; // "string"
type T2 = TypeName<() => void>; // "function"
```

### 3. 映射类型

**目的：** 通过遍历现有类型的属性来转换类型。

**基础映射类型：**

```typescript
type Readonly<T> = {
  readonly [P in keyof T]: T[P];
};

type User = {
  id: number;
  name: string;
};

type ReadonlyUser = Readonly<User>;
// 类型: { readonly id: number; readonly name: string; }
```

**可选属性：**

```typescript
type Partial<T> = {
  [P in keyof T]?: T[P];
};

type PartialUser = Partial<User>;
// 类型: { id?: number; name?: string; }
```

**键重映射：**

```typescript
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

type Person = {
  name: string;
  age: number;
};

type PersonGetters = Getters<Person>;
// 类型: { getName: () => string; getAge: () => number; }
```

**属性过滤：**

```typescript
type PickByType<T, U> = {
  [K in keyof T as T[K] extends U ? K : never]: T[K];
};

type Mixed = {
  id: number;
  name: string;
  age: number;
  active: boolean;
};

type OnlyNumbers = PickByType<Mixed, number>;
// 类型: { id: number; age: number; }
```

### 4. 模板字面量类型

**目的：** 创建具有模式匹配和转换功能的字符串类型。

**基础模板字面量：**

```typescript
type EventName = "click" | "focus" | "blur";
type EventHandler = `on${Capitalize<EventName>}`;
// 类型: "onClick" | "onFocus" | "onBlur"
```

**字符串操作：**

```typescript
type UppercaseGreeting = Uppercase<"hello">; // "HELLO"
type LowercaseGreeting = Lowercase<"HELLO">; // "hello"
type CapitalizedName = Capitalize<"john">; // "John"
type UncapitalizedName = Uncapitalize<"John">; // "john"
```

**路径构建：**

```typescript
type Path<T> = T extends object
  ? {
      [K in keyof T]: K extends string ? `${K}` | `${K}.${Path<T[K]>}` : never;
    }[keyof T]
  : never;

type Config = {
  server: {
    host: string;
    port: number;
  };
  database: {
    url: string;
  };
};

type ConfigPath = Path<Config>;
// 类型: "server" | "database" | "server.host" | "server.port" | "database.url"
```

### 5. 工具类型

**内置工具类型：**

```typescript
// Partial<T> - 使所有属性可选
type PartialUser = Partial<User>;

// Required<T> - 使所有属性必需
type RequiredUser = Required<PartialUser>;

// Readonly<T> - 使所有属性只读
type ReadonlyUser = Readonly<User>;

// Pick<T, K> - 选择特定属性
type UserName = Pick<User, "name" | "email">;

// Omit<T, K> - 移除特定属性
type UserWithoutPassword = Omit<User, "password">;

// Exclude<T, U> - 从联合类型中排除类型
type T1 = Exclude<"a" | "b" | "c", "a">; // "b" | "c"

// Extract<T, U> - 从联合类型中提取类型
type T2 = Extract<"a" | "b" | "c", "a" | "b">; // "a" | "b"

// NonNullable<T> - 排除 null 和 undefined
type T3 = NonNullable<string | null | undefined>; // string

// Record<K, T> - 创建键为 K、值为 T 的对象类型
type PageInfo = Record<"home" | "about", { title: string }>;
```

## 高级模式

### 模式 1：类型安全的事件发射器

```typescript
type EventMap = {
  "user:created": { id: string; name: string };
  "user:updated": { id: string };
  "user:deleted": { id: string };
};

class TypedEventEmitter<T extends Record<string, any>> {
  private listeners: {
    [K in keyof T]?: Array<(data: T[K]) => void>;
  } = {};

  on<K extends keyof T>(event: K, callback: (data: T[K]) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(callback);
  }

  emit<K extends keyof T>(event: K, data: T[K]): void {
    const callbacks = this.listeners[event];
    if (callbacks) {
      callbacks.forEach((callback) => callback(data));
    }
  }
}

const emitter = new TypedEventEmitter<EventMap>();

emitter.on("user:created", (data) => {
  console.log(data.id, data.name); // 类型安全！
});

emitter.emit("user:created", { id: "1", name: "John" });
// emitter.emit("user:created", { id: "1" });  // 错误: 缺少 'name'
```

### 模式 2：类型安全的 API 客户端

```typescript
type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE";

type EndpointConfig = {
  "/users": {
    GET: { response: User[] };
    POST: { body: { name: string; email: string }; response: User };
  };
  "/users/:id": {
    GET: { params: { id: string }; response: User };
    PUT: { params: { id: string }; body: Partial<User>; response: User };
    DELETE: { params: { id: string }; response: void };
  };
};

type ExtractParams<T> = T extends { params: infer P } ? P : never;
type ExtractBody<T> = T extends { body: infer B } ? B : never;
type ExtractResponse<T> = T extends { response: infer R } ? R : never;

class APIClient<Config extends Record<string, Record<HTTPMethod, any>>> {
  async request<Path extends keyof Config, Method extends keyof Config[Path]>(
    path: Path,
    method: Method,
    ...[options]: ExtractParams<Config[Path][Method]> extends never
      ? ExtractBody<Config[Path][Method]> extends never
        ? []
        : [{ body: ExtractBody<Config[Path][Method]> }]
      : [
          {
            params: ExtractParams<Config[Path][Method]>;
            body?: ExtractBody<Config[Path][Method]>;
          },
        ]
  ): Promise<ExtractResponse<Config[Path][Method]>> {
    // 实现代码
    return {} as any;
  }
}

const api = new APIClient<EndpointConfig>();

// 类型安全的 API 调用
const users = await api.request("/users", "GET");
// 类型: User[]

const newUser = await api.request("/users", "POST", {
  body: { name: "John", email: "john@example.com" },
});
// 类型: User

const user = await api.request("/users/:id", "GET", {
  params: { id: "123" },
});
// 类型: User
```

### 模式 3：类型安全的建造者模式

```typescript
type BuilderState<T> = {
  [K in keyof T]: T[K] | undefined;
};

type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

type IsComplete<T, S> =
  RequiredKeys<T> extends keyof S
    ? S[RequiredKeys<T>] extends undefined
      ? false
      : true
    : false;

class Builder<T, S extends BuilderState<T> = {}> {
  private state: S = {} as S;

  set<K extends keyof T>(key: K, value: T[K]): Builder<T, S & Record<K, T[K]>> {
    this.state[key] = value;
    return this as any;
  }

  build(this: IsComplete<T, S> extends true ? this : never): T {
    return this.state as T;
  }
}

type User = {
  id: string;
  name: string;
  email: string;
  age?: number;
};

const builder = new Builder<User>();

const user = builder
  .set("id", "1")
  .set("name", "John")
  .set("email", "john@example.com")
  .build(); // OK: 所有必需字段已设置

// const incomplete = builder
//   .set("id", "1")
//   .build();  // 错误: 缺少必需字段
```

### 模式 4：深度只读/可选

```typescript
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object
    ? T[P] extends Function
      ? T[P]
      : DeepReadonly<T[P]>
    : T[P];
};

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object
    ? T[P] extends Array<infer U>
      ? Array<DeepPartial<U>>
      : DeepPartial<T[P]>
    : T[P];
};

type Config = {
  server: {
    host: string;
    port: number;
    ssl: {
      enabled: boolean;
      cert: string;
    };
  };
  database: {
    url: string;
    pool: {
      min: number;
      max: number;
    };
  };
};

type ReadonlyConfig = DeepReadonly<Config>;
// 所有嵌套属性都是只读的

type PartialConfig = DeepPartial<Config>;
// 所有嵌套属性都是可选的
```

### 模式 5：类型安全的表单验证

```typescript
type ValidationRule<T> = {
  validate: (value: T) => boolean;
  message: string;
};

type FieldValidation<T> = {
  [K in keyof T]?: ValidationRule<T[K]>[];
};

type ValidationErrors<T> = {
  [K in keyof T]?: string[];
};

class FormValidator<T extends Record<string, any>> {
  constructor(private rules: FieldValidation<T>) {}

  validate(data: T): ValidationErrors<T> | null {
    const errors: ValidationErrors<T> = {};
    let hasErrors = false;

    for (const key in this.rules) {
      const fieldRules = this.rules[key];
      const value = data[key];

      if (fieldRules) {
        const fieldErrors: string[] = [];

        for (const rule of fieldRules) {
          if (!rule.validate(value)) {
            fieldErrors.push(rule.message);
          }
        }

        if (fieldErrors.length > 0) {
          errors[key] = fieldErrors;
          hasErrors = true;
        }
      }
    }

    return hasErrors ? errors : null;
  }
}

type LoginForm = {
  email: string;
  password: string;
};

const validator = new FormValidator<LoginForm>({
  email: [
    {
      validate: (v) => v.includes("@"),
      message: "邮箱必须包含 @",
    },
    {
      validate: (v) => v.length > 0,
      message: "邮箱为必填项",
    },
  ],
  password: [
    {
      validate: (v) => v.length >= 8,
      message: "密码至少需要 8 个字符",
    },
  ],
});

const errors = validator.validate({
  email: "invalid",
  password: "short",
});
// 类型: { email?: string[]; password?: string[]; } | null
```

### 模式 6：可辨识联合

```typescript
type Success<T> = {
  status: "success";
  data: T;
};

type Error = {
  status: "error";
  error: string;
};

type Loading = {
  status: "loading";
};

type AsyncState<T> = Success<T> | Error | Loading;

function handleState<T>(state: AsyncState<T>): void {
  switch (state.status) {
    case "success":
      console.log(state.data); // 类型: T
      break;
    case "error":
      console.log(state.error); // 类型: string
      break;
    case "loading":
      console.log("加载中...");
      break;
  }
}

// 类型安全的状态机
type State =
  | { type: "idle" }
  | { type: "fetching"; requestId: string }
  | { type: "success"; data: any }
  | { type: "error"; error: Error };

type Event =
  | { type: "FETCH"; requestId: string }
  | { type: "SUCCESS"; data: any }
  | { type: "ERROR"; error: Error }
  | { type: "RESET" };

function reducer(state: State, event: Event): State {
  switch (state.type) {
    case "idle":
      return event.type === "FETCH"
        ? { type: "fetching", requestId: event.requestId }
        : state;
    case "fetching":
      if (event.type === "SUCCESS") {
        return { type: "success", data: event.data };
      }
      if (event.type === "ERROR") {
        return { type: "error", error: event.error };
      }
      return state;
    case "success":
    case "error":
      return event.type === "RESET" ? { type: "idle" } : state;
  }
}
```

## 类型推断技术

### 1. infer 关键字

```typescript
// 提取数组元素类型
type ElementType<T> = T extends (infer U)[] ? U : never;

type NumArray = number[];
type Num = ElementType<NumArray>; // number

// 提取 Promise 类型
type PromiseType<T> = T extends Promise<infer U> ? U : never;

type AsyncNum = PromiseType<Promise<number>>; // number

// 提取函数参数
type Parameters<T> = T extends (...args: infer P) => any ? P : never;

function foo(a: string, b: number) {}
type FooParams = Parameters<typeof foo>; // [string, number]
```

### 2. 类型守卫

```typescript
function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

const data: unknown = ["a", "b", "c"];

if (isArrayOf(data, isString)) {
  data.forEach((s) => s.toUpperCase()); // 类型: string[]
}
```

### 3. 断言函数

```typescript
function assertIsString(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new Error("不是字符串");
  }
}

function processValue(value: unknown) {
  assertIsString(value);
  // value 现在被类型化为 string
  console.log(value.toUpperCase());
}
```

## 最佳实践

1. **使用 `unknown` 而非 `any`**：强制进行类型检查
2. **统一使用 `type` 定义类型**：语法一致，支持联合、交叉、映射等所有类型操作
3. **善用类型别名**：提高代码可读性
4. **利用类型推断**：让 TypeScript 在可能时自动推断
5. **创建辅助类型**：构建可复用的类型工具
6. **使用 const 断言**：保留字面量类型
7. **避免类型断言**：使用类型守卫代替
8. **为复杂类型添加文档**：添加 JSDoc 注释
9. **使用严格模式**：启用所有严格编译器选项
10. **测试你的类型**：使用类型测试验证类型行为

## 类型测试

```typescript
// 类型断言测试
type AssertEqual<T, U> = [T] extends [U]
  ? [U] extends [T]
    ? true
    : false
  : false;

type Test1 = AssertEqual<string, string>; // true
type Test2 = AssertEqual<string, number>; // false
type Test3 = AssertEqual<string | number, string>; // false

// 期望错误辅助类型
type ExpectError<T extends never> = T;

// 使用示例
type ShouldError = ExpectError<AssertEqual<string, number>>;
```

## 常见陷阱

1. **过度使用 `any`**：违背了 TypeScript 的目的
2. **忽略严格空值检查**：可能导致运行时错误
3. **类型过于复杂**：可能拖慢编译速度
4. **不使用可辨识联合**：错失类型收窄的机会
5. **忘记 readonly 修饰符**：允许意外的修改
6. **循环类型引用**：可能导致编译器错误
7. **未处理边界情况**：如空数组或 null 值

## 性能考虑

- 避免深度嵌套的条件类型
- 尽可能使用简单类型
- 缓存复杂的类型计算
- 限制递归类型的递归深度
- 在生产环境使用构建工具跳过类型检查

## 资源

- **TypeScript 手册**：https://www.typescriptlang.org/docs/handbook/
- **Type Challenges**：https://github.com/type-challenges/type-challenges
- **TypeScript Deep Dive**：https://basarat.gitbook.io/typescript/
- **Effective TypeScript**：Dan Vanderkam 著
