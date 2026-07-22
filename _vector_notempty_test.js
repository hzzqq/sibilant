// _vector_notempty_test.js — Sibilant vector / not-empty? 单元测试
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- vector ----
ok('vector 构造', lispStr(run('(vector 1 2 3)')) === '(1 2 3)');
ok('vector 空', lispStr(run('(vector)')) === '()');
ok('vector 单元素', lispStr(run('(vector 42)')) === '(42)');
ok('vector 符号', lispStr(run('(vector (quote a) (quote b))')) === '(a b)');
ok('vector 嵌套', lispStr(run('(vector (vector 1 2) (vector 3 4))')) === '((1 2) (3 4))');

// ---- not-empty? ----
ok('not-empty? 非空列表为真', lispStr(run('(not-empty? (list 1))')) === '#t');
ok('not-empty? 空列表为假', lispStr(run('(not-empty? (list))')) === '#f');
ok('not-empty? 非空串为真', lispStr(run('(not-empty? "a")')) === '#t');
ok('not-empty? 空串为假', lispStr(run('(not-empty? "")')) === '#f');
ok('not-empty? nil 为假', lispStr(run('(not-empty? ())')) === '#f');
ok('not-empty? vector 为真', lispStr(run('(not-empty? (vector 1))')) === '#t');

// ---- 全局可见性（接线）----
ok('vector 在全局可见', typeof run('vector') === 'function');
ok('not-empty? 在全局可见', typeof run('not-empty?') === 'function');

console.log(`vector/not-empty?: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
