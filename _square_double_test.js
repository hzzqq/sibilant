// _square_double_test.js — Sibilant square / double 单元测试
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- square ----
ok('square 正数', run('(square 5)') === 25);
ok('square 负数', run('(square -3)') === 9);
ok('square 零', run('(square 0)') === 0);
ok('square 浮点', run('(square 2.5)') === 6.25);

// ---- double ----
ok('double 整数', run('(double 21)') === 42);
ok('double 零', run('(double 0)') === 0);
ok('double 浮点', run('(double 2.5)') === 5);
ok('double 负数', run('(double -4)') === -8);

// ---- 组合 ----
ok('组合 double(square 3)', run('(double (square 3))') === 18);
ok('组合 square(double 2)', run('(square (double 2))') === 16);

// ---- 全局可见性（接线）----
ok('square 在全局可见', typeof run('square') === 'function');
ok('double 在全局可见', typeof run('double') === 'function');

console.log(`square/double: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
