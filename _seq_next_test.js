// _seq_next_test.js — Sibilant seq? / next 单元测试
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- seq? ----
ok('seq? 列表为真', lispStr(run('(seq? (list 1 2))')) === '#t');
ok('seq? 字符串为真', lispStr(run('(seq? "abc")')) === '#t');
ok('seq? 数字为假', lispStr(run('(seq? 5)')) === '#f');
ok('seq? dict 为假', lispStr(run('(seq? (dict (quote a) 1))')) === '#f');
ok('seq? 空列表为真', lispStr(run('(seq? ())')) === '#t');

// ---- next ----
ok('next 正常', lispStr(run('(next (list 1 2 3))')) === '(2 3)');
ok('next 单元素', lispStr(run('(next (list 1))')) === '()');
ok('next 空列表', lispStr(run('(next (list))')) === '()');
ok('next 字符串', lispStr(run('(next "abc")')) === '"bc"');
ok('next 嵌套', lispStr(run('(next (next (list 1 2 3 4)))')) === '(3 4)');

// ---- 全局可见性（接线）----
ok('seq? 在全局可见', typeof run('seq?') === 'function');
ok('next 在全局可见', typeof run('next') === 'function');

console.log(`seq?/next: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
