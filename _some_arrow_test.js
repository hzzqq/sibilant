// _some_arrow_test.js — Sibilant some-> (ci295) 单元测试 + 隐性问题(cycle 空列表)验证
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- some-> (特殊形式，nil 短路) ----
ok('some-> 正常线程', run('(some-> (list 1 2) rest first)') === 2);
ok('some-> 空序列短路', lispStr(run('(some-> (list) rest first)')) === '()');
ok('some-> 中间出现nil短路', lispStr(run('(some-> (list 1 2) car cdr)')) === '()');

// ---- R2 隐性问题：cycle 对空列表曾推入 undefined，现在返回() ----
ok('cycle 空列表返回()', lispStr(run('(cycle 3 (list))')) === '()');
ok('cycle n<=0 返回()', lispStr(run('(cycle 0 (list 1 2))')) === '()');
ok('cycle 正常', lispStr(run('(cycle 5 (list 1 2))')) === '(1 2 1 2 1)');

console.log(`some->: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
