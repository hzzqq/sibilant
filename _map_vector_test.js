// _map_vector_test.js — Sibilant map? / vector? 单元测试
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- map? ----
ok('map? dict 为真', lispStr(run('(map? (dict (quote a) 1))')) === '#t');
ok('map? 列表为假', lispStr(run('(map? (list 1 2))')) === '#f');
ok('map? 字符串为假', lispStr(run('(map? "x")')) === '#f');
ok('map? nil 为假', lispStr(run('(map? ())')) === '#f');

// ---- vector? ----
ok('vector? vector 为真', lispStr(run('(vector? (vector 1 2))')) === '#t');
ok('vector? 列表为真', lispStr(run('(vector? (list 1 2))')) === '#t');
ok('vector? dict 为假', lispStr(run('(vector? (dict (quote a) 1))')) === '#f');
ok('vector? 字符串为假', lispStr(run('(vector? "x")')) === '#f');
ok('vector? 数字为假', lispStr(run('(vector? 5)')) === '#f');

// ---- 全局可见性（接线）----
ok('map? 在全局可见', typeof run('map?') === 'function');
ok('vector? 在全局可见', typeof run('vector?') === 'function');

console.log(`map?/vector?: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
