// ci415 — Sibilant 反射/元批：eval-expr / apply-fn / type-of / arity / doc-of
// 隐性修复：给未登记文档的内置 error 补 doc 字符串。
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();

const S = global.window.Sibilant;
if (!S || typeof S.run !== 'function') { console.error('FAIL: runtime not attached'); process.exit(1); }

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.error(`FAIL ${name}: got ${g}, want ${w}`); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error(`FAIL ${name}`); } }
function run(src) { return S.run(src); }

// ---------- eval-expr（包装 eval）----------
eq('eval-expr 字符串', run('(eval-expr "(+ 1 2)")'), 3);
eq('eval-expr 嵌套', run('(eval-expr "(list 1 2 3)")'), [1,2,3]);
ok('eval-expr 文档存在', typeof run('(doc "eval-expr")') === 'string');

// ---------- apply-fn（包装 apply）----------
eq('apply-fn +', run('(apply-fn + (list 1 2 3))'), 6);
eq('apply-fn lambda', run('(apply-fn (lambda (a b) (* a b)) (list 4 5))'), 20);
ok('apply-fn 非列表报错', (() => { try { run('(apply-fn + 5)'); return false; } catch(e){ return true; } })());
ok('apply-fn 文档存在', typeof run('(doc "apply-fn")') === 'string');

// ---------- type-of ----------
eq('type-of number', run('(type-of 3)'), 'number');
eq('type-of string', run('(type-of "x")'), 'string');
eq('type-of list', run('(type-of (list 1 2))'), 'list');
eq('type-of boolean', run('(type-of #t)'), 'boolean');
eq('type-of null', run('(type-of (car (list)))'), 'null');
eq('type-of () 为空列表/lisp-nil -> list', run('(type-of ())'), 'list');
eq('type-of dict', run('(type-of (dict))'), 'dict');
eq('type-of lambda', run('(type-of (lambda (x) x))'), 'lambda');
ok('type-of 文档存在', typeof run('(doc "type-of")') === 'string');

// ---------- arity ----------
eq('arity 固定参数 lambda', run('(arity (lambda (a b) b))'), 2);
eq('arity 单参', run('(arity (lambda (x) x))'), 1);
eq('arity 变参(lambda &rest) -> -1', run('(arity (lambda (a & xs) a))'), -1);
eq('arity 内置 +', run('(arity +)'), 0); // 内置 + 声明 length 0（变参）
ok('arity 文档存在', typeof run('(doc "arity")') === 'string');

// ---------- doc-of ----------
ok('doc-of 查符号文档', (() => { const d = run('(doc-of "rand")'); return typeof d === 'string' && d.length > 0; })());
ok('doc-of 查函数文档', (() => { const d = run('(doc-of +)'); return d === null || typeof d === 'string'; })());
ok('doc-of 文档存在', typeof run('(doc "doc-of")') === 'string');

// ---------- 隐性修复验证：error 文档 ----------
ok('error 文档已补登', typeof run('(doc "error")') === 'string');
ok('error 仍抛错', (() => { try { run('(error "boom")'); return false; } catch(e){ return true; } })());

console.log(`ci415(meta): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
