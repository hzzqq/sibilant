// _fn_int_test.js — Sibilant fn? / int? 单元测试
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- fn? ----
ok('fn? lambda 为真', lispStr(run('(fn? (lambda (x) x))')) === '#t');
ok('fn? 内置函数为真', lispStr(run('(fn? +)')) === '#t');
ok('fn? 数字为假', lispStr(run('(fn? 5)')) === '#f');
ok('fn? 字符串为假', lispStr(run('(fn? "x")')) === '#f');
ok('fn? 应用后的函数为真', lispStr(run('(fn? (car (list + -)))')) === '#t');

// ---- int? ----
ok('int? 正整数为真', lispStr(run('(int? 5)')) === '#t');
ok('int? 负整数为真', lispStr(run('(int? -3)')) === '#t');
ok('int? 浮点为假', lispStr(run('(int? 2.5)')) === '#f');
ok('int? 字符串为假', lispStr(run('(int? "5")')) === '#f');
ok('int? 零为真', lispStr(run('(int? 0)')) === '#t');

// ---- 全局可见性（接线）----
ok('fn? 在全局可见', typeof run('fn?') === 'function');
ok('int? 在全局可见', typeof run('int?') === 'function');

console.log(`fn?/int?: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
