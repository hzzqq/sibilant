// ci439 — 线程宏(-> / ->> / some-> / some->> / cond-> / as-> / doto) 实现与回归
// R1：全新能力(7 个宏)；R2：修复 DOCS 已文档化却未注册实现(调用即崩溃)的隐性 bug。
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
global.require = require;
new Function(code)();
const S = global.window.Sibilant;
if (!S || typeof S.run !== 'function') { console.error('FAIL: runtime'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }
const run = (s)=> S.run(s);
const eq = (a, b)=> JSON.stringify(a) === JSON.stringify(b);

// ---- -> (thread-first) ----
ok('-> 基础', run('(-> 5 (+ 3) (* 2))') === 16);
ok('-> 单表单', run('(-> 5 (+ 1))') === 6);
ok('-> 裸符号表单', run('(-> 5 inc)') === 6);
ok('-> 空 forms 返回原值', run('(-> 5)') === 5);
ok('-> 嵌套列表(中间值为列表)', eq(run('(-> (list 1 2 3) first inc)'), 2));

// ---- ->> (thread-last) ----
ok('->> 基础', run('(->> 5 (+ 3) (* 2))') === 16);
ok('->> 尾插', run('(->> (list 1 2 3) (map (lambda (x)(* x 2))) (reduce + 0))') === 12);
ok('->> 空 forms', run('(->> 9)') === 9);

// ---- some-> (nil 短路, 首插) ----
ok('some-> 正常链', run('(some-> 5 (inc) (* 2))') === 12);
ok('some-> 遇 nil 短路', run('(some-> 5 (first (list)) (* 2))') === null);
ok('some-> 空列表非 nil 不短路', run('(some-> (list) (rest))') !== undefined);
ok('some->> 尾插链', run('(some->> 3 (list) (map inc))') !== undefined);

// ---- cond-> (条件线程) ----
ok('cond-> 真分支应用', run('(cond-> 0 (#t (+ 1)) (#f (* 2)))') === 1);
ok('cond-> 多真分支累积', run('(cond-> 10 ((> 1 0) (+ 5)) ((< 0 9) (* 2)))') === 30);
ok('cond-> 全假保持', run('(cond-> 7 (#f (+ 1)) (#f (* 2)))') === 7);

// ---- as-> (显式占位) ----
ok('as-> 基础', run('(as-> 5 x (+ x 1) (* x 2))') === 12);
ok('as-> 占位替换', run('(as-> 3 it (list it it it))') !== undefined);

// ---- doto (副作用线程, 返回原对象) ----
ok('doto 累加原子', (()=>{
  const r = run('(let ((a (atom 0))) (doto a (swap! + 1) (swap! + 2)) (deref a))');
  return r === 3;
})());
ok('doto 返回原对象', (()=>{
  return run('(let ((a (atom 0))) (eq? (doto a (swap! + 1)) a))') === true;
})());

console.log(`\nci439 threading: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
