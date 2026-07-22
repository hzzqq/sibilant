// _nfirst_test.js — Sibilant nfirst / nthrest 单元测试
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- nfirst ----
ok('nfirst 取前2个', lispStr(run('(nfirst 2 (list 1 2 3 4))')) === '(1 2)');
ok('nfirst 超出长度截断', lispStr(run('(nfirst 10 (list 1 2))')) === '(1 2)');
ok('nfirst 取0个', lispStr(run('(nfirst 0 (list 1 2))')) === '()');
ok('nfirst 符号列表', lispStr(run('(nfirst 1 (list (quote a) (quote b) (quote c)))')) === '(a)');
ok('nfirst 嵌套', lispStr(run('(nfirst 1 (nthrest 1 (list 1 2 3)))')) === '(2)');

// ---- nthrest ----
ok('nthrest 取第1之后', lispStr(run('(nthrest 1 (list (quote a) (quote b) (quote c)))')) === '(b c)');
ok('nthrest 取第0之后(全量)', lispStr(run('(nthrest 0 (list 1 2 3))')) === '(1 2 3)');
ok('nthrest 超出返回空', lispStr(run('(nthrest 5 (list 1 2 3))')) === '()');
ok('nthrest 取末尾一个', lispStr(run('(nthrest 2 (list 1 2 3))')) === '(3)');

// ---- 全局可见性（接线）----
ok('nfirst 在全局可见', typeof run('nfirst') === 'function');
ok('nthrest 在全局可见', typeof run('nthrest') === 'function');

console.log(`nfirst/nthrest: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
