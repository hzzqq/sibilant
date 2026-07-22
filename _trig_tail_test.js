// ci171 — Sibilant 反三角函数 + 列表尾部/索引工具：atan2 / asin / acos / take-last / drop-last / enumerate / repeat
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();

const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('  FAIL', name); } }
const near = (a, b, e=1e-6)=> Math.abs(a - b) < e;

// ---- 反三角函数 ----
ok('atan2 1 0 = π/2', near(run('(atan2 1 0)'), Math.PI / 2));
ok('atan2 0 1 = 0', near(run('(atan2 0 1)'), 0));
ok('atan2 -1 0 = -π/2', near(run('(atan2 -1 0)'), -Math.PI / 2));
ok('asin 1 = π/2', near(run('(asin 1)'), Math.PI / 2));
ok('acos 0 = π/2', near(run('(acos 0)'), Math.PI / 2));
ok('asin 0 = 0', near(run('(asin 0)'), 0));

// ---- take-last / drop-last ----
ok('take-last 2', lispStr(run('(take-last (list 1 2 3 4) 2)')) === '(3 4)');
ok('drop-last 2', lispStr(run('(drop-last (list 1 2 3 4) 2)')) === '(1 2)');
ok('take-last 超出长度', lispStr(run('(take-last (list 1 2) 9)')) === '(1 2)');
ok('drop-last 超出长度', lispStr(run('(drop-last (list 1 2) 9)')) === '()');

// ---- enumerate ----
ok('enumerate 双元素', lispStr(run('(enumerate (list "a" "b"))')) === '((0 "a") (1 "b"))');
ok('enumerate 空', lispStr(run('(enumerate (list))')) === '()');

// ---- repeat ----
ok('repeat 7 3', lispStr(run('(repeat 7 3)')) === '(7 7 7)');
ok('repeat n=0', lispStr(run('(repeat 7 0)')) === '()');
ok('repeat 拼接', lispStr(run('(append (repeat 1 2) (repeat 2 2))')) === '(1 1 2 2)');

// ---- 接线：doc 注册 ----
ok('doc atan2', run('(doc "atan2")') !== null);
ok('doc take-last', run('(doc "take-last")') !== null);
ok('doc enumerate', run('(doc "enumerate")') !== null);
ok('doc repeat', run('(doc "repeat")') !== null);

console.log(`lang/_trig_tail_test.js  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
