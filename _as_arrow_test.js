// _as_arrow_test.js — Sibilant as-> (ci291) 单元测试 + 隐性问题(take/drop 负n)验证
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- as-> (特殊形式，显式占位线程) ----
ok('as-> 链式变换', run('(as-> 5 x (+ x 1) (* x 2) (- x 3))') === 9);
ok('as-> 占位出现在中间', lispStr(run('(as-> 10 x (list x x))')) === '(10 10)');
ok('as-> 嵌套替换', run('(as-> 3 x (+ x (inc x)))') === 7);

// ---- R2 隐性问题：take/drop 负 n 曾产生怪异切片，现在按 0 处理 ----
ok('take 负n 视作0 => ()', lispStr(run('(take (list 1 2 3) -1)')) === '()');
ok('drop 负n 视作0 => 原表', lispStr(run('(drop (list 1 2 3) -2)')) === '(1 2 3)');
ok('take 正常', lispStr(run('(take (list 1 2 3 4) 2)')) === '(1 2)');
ok('drop 正常', lispStr(run('(drop (list 1 2 3 4) 2)')) === '(3 4)');

console.log(`as->: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
