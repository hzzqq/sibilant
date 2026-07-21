# Sibilant · 自研 Lisp 方言解释器

> 从零手写的 Lisp 解释器：词法分析 → 递归下降解析 → 树遍历求值 + 词法作用域闭包。带宏系统、尾递归优化（TCO）、模式匹配、哈希表、行号定位的运行时错误回溯，以及一个暗色 REPL。

![tech](https://img.shields.io/badge/Lisp-Interpreter-c792ea) ![tco](https://img.shields.io/badge/TCO-trampoline-yellow) ![tests](https://img.shields.io/badge/tests-261-brightgreen) ![license](https://img.shields.io/badge/license-MIT-green)

---

## ✨ 特性

- **完整的求值管线**：手写 `tokenize` → `parseAll`（递归下降）→ `ev`（树遍历求值）+ 词法作用域闭包。
- **宏系统**：`defmacro` + quasiquote（`` ` `` 反引号 / `,` 反引用 / `,@` 反引用拼接 / `&` 变参），编译期展开。
- **尾递归优化（TCO）**：trampoline 机制——尾位置调用返回 `{__tail}` 标记，由 `resolveTail` 循环展开，**十万次递归不爆栈**。
- **模式匹配 `match`**：字面量 / 绑定 / 通配 `_` / `list` / `cons` / `quote` / 守卫 `?`。
- **记录类型 `defstruct`**：自动生成构造器、字段访问器 `Name-field`、谓词 `Name?`。
- **哈希表 `dict`**：原生 `Map` 封装，**O(1) 查找**，不可变（`dict-set`/`dict-del` 返回新字典）。
- **绑定形式**：`let` / `let*` 顺序绑定 / `letrec` 互递归绑定 / `loop` 命名 let（走 TCO）/ `case` 等值分发。
- **异常处理**：`try` / `catch` 捕获并绑定错误信息；`error` 主动抛错；`eval` 求值字符串或 AST。
- **错误行号定位**：tokenizer 记录行号，`Sym`/列表携带 `.line`，报错时附 `【行 N】` 并回显该行源码片段 + 调用栈回溯（尾调用链自动压平）。
- **内置库**：算术、谓词、字符串（`string-split`/`join`/`replace`/`format` 等）、序列折叠（`foldl`/`foldr`/`zip`/`for-each`/`assoc`/`acons`）、列表原语。
- **数值库扩容**：`gcd`/`lcm`/`signum`/`floor-div`/`quotient`/`random-int`/`integer?`，并对 `/`、`mod`、`floor-div` 补**除零保护**（除数为 0 抛 `lispError`）。`random-int` 单参已修正为上界开区间 `[0,n)`。
- **文档系统**：`D(name, docString)` 注册函数文档，`help`/`doc`/`docs` 内置可查（自带库亦带文档）。
- **正则内置**：`regex-match` / `regex-test` / `regex-find-all` / `regex-replace` / `regex-split` 五个，基于原生 `RegExp`，返回捕获组 / 匹配列表 / 替换结果等。
- **JSON 互操作**：`json-encode` / `json-decode` / `json?` 在 Lisp 值（列表 / 字典 / 集合 / 字符串）与 JSON 之间互转，支持嵌套与往返。
- **惰性求值**：`delay`/`force`/`promise?` + 惰性序列 `lazy-cons`/`lazy-car`/`lazy-cdr`/`lazy-take`（记忆化 + 无限流）。
- **序列工具补全**：`range` 支持 `(start,end,step)` 三参写法；新增 `sort`（可选比较器）/ `drop` / `last` / `flatten` / `any?` / `every?`。并清理 STDLIB 预置库中与内置**参数序不一致/重复定义**的 `drop`/`flatten`/`last`/`any?`/`every?`（修复 `drop` 因签名翻转被覆盖的隐性 bug）。
- **记忆化**：`memoize` 高阶函数按参数元组缓存结果，附 `memoized?` 判定与 `memo-cache-size` 观测。
- **暗色 REPL**：示例按钮、历史导航（↑/↓）、多行（Shift+Enter）。

## 🧱 技术栈

纯 JavaScript（零依赖），浏览器内运行；测试用 Node 跑。

## 🚀 运行

```bash
# 1. REPL（需 HTTP，因为 <script> 引入）
python -m http.server 8080
#    浏览器打开 http://localhost:8080/index.html

# 2. 测试
node _smoke.js      # 251/251
node _cli_test.js   # 10/10
```

## 📝 示例

```scheme
;; 尾递归（十万次不爆栈）
(define (sum n acc) (if (= n 0) acc (sum (- n 1) (+ acc n))))
(sum 100000 0)   ; => 5000050000

;; 宏 + quasiquote
(defmacro when (test & body) `(if ,test (begin ,@body)))
(when (> 3 1) 'yes)

;; 哈希表（O(1)）
(dict-get (dict 'a 1 'b 2) 'a)   ; => 1

;; 模式匹配
(match (list 1 2 3) ((cons h t) h) (else 0))   ; => 1

;; 错误带行号
(define (f x) (+ x 1))
(f y)   ; => 【行 2】未定义符号: y
        ;      > (f y)
```

## 🏗 架构

```
interpreter.js
 ├─ tokenize()    —— 词法分析（记行号）
 ├─ parseAll()    —— 递归下降解析（节点带 .line）
 ├─ ev()          —— 树遍历求值 + TCO 尾标记
 ├─ resolveTail() —— trampoline 展开尾调用
 ├─ qq()/qqTail() —— quasiquote 展开
 ├─ matchPattern()—— 模式匹配
 ├─ lispError()   —— 附行号 + 调用栈
 ├─ setupBuiltins()—— 内置函数库
 └─ run()         —— 顶层入口（错误时拼【行 N】+源码片段+栈）
index.html —— 暗色 REPL
_smoke.js  —— 251 项冒烟测试
_cli_test.js —— 10 项 CLI 测试（文件 IO / 命令行入口）
```

## 📄 许可

MIT © hzzqq
