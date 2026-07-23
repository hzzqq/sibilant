// ci379 — Sibilant 函数组合批：pipe / curry（compose / partial / identity 已存在）
// 隐性修复：compose（STDLIB 定义）此前缺 doc 字符串 -> 补登文档。
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();

const S = global.window.Sibilant;
if (!S || typeof S.run !== 'function') {
  console.error('FAIL: Sibilant runtime not attached to window');
  process.exit(1);
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${g}, want ${w}`); }
}
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error(`FAIL ${name}`); } }
function run(src) { return S.run(src); }

// ---------- pipe（左到右组合）----------
eq('pipe 两步', run('((pipe (lambda(x)(+ x 1)) (lambda(x)(* x 2))) 3)'), 8);
eq('pipe 单函恒等', run('((pipe abs) -5)'), 5);
eq('pipe 零参恒等', run('((pipe) 7)'), 7);
eq('pipe 三步', run('((pipe (lambda(x)(+ x 1)) (lambda(x)(* x 2)) (lambda(x)(- x 1))) 3)'), 7);

// ---------- curry（柯里化）----------
eq('curry 一次性', run('((curry (lambda(a b c)(+ a b c)) 3) 1 2 3)'), 6);
eq('curry 分次 application', run('(((curry + 3) 1) 2 3)'), 6);
eq('curry 部分后再收尾', run('((curry (lambda(a b)(* a b)) 2) 6 7)'), 42);

// ---------- 已存在函数（批次内验证，不重定义）----------
eq('compose 右到左', run('((compose abs -) 5)'), 5);
eq('partial 偏应用', run('((partial + 10) 5)'), 15);
eq('identity 原样', run('(identity 7)'), 7);
eq('identity 用于 map', run('(map identity (list 1 2 3))'), [1, 2, 3]);

// ---------- 隐性修复验证：compose doc ----------
ok('compose 文档已补登', (() => { const d = run('(doc "compose")'); return typeof d === 'string' && d.indexOf('右到左') >= 0; })());
ok('partial 文档存在', (() => { const d = run('(doc "partial")'); return typeof d === 'string'; })());
ok('identity 文档存在', (() => { const d = run('(doc "identity")'); return typeof d === 'string'; })());

console.log(`ci379(combinators): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
