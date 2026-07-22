// _char_sorted_test.js — Sibilant char? / sorted? 单元测试
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- char? ----
ok('char? 单字符为真', lispStr(run('(char? "a")')) === '#t');
ok('char? 多字符为假', lispStr(run('(char? "ab")')) === '#f');
ok('char? 空串为假', lispStr(run('(char? "")')) === '#f');
ok('char? 数字为假', lispStr(run('(char? 5)')) === '#f');

// ---- sorted? ----
ok('sorted? 升序为真', lispStr(run('(sorted? (list 1 2 3))')) === '#t');
ok('sorted? 降序为假', lispStr(run('(sorted? (list 3 1 2))')) === '#f');
ok('sorted? 空列表为真', lispStr(run('(sorted? (list))')) === '#t');
ok('sorted? 单元素为真', lispStr(run('(sorted? (list 7))')) === '#t');
ok('sorted? 含相等元素为真', lispStr(run('(sorted? (list 1 2 2 3))')) === '#t');
ok('sorted? 非列表为假', lispStr(run('(sorted? 5)')) === '#f');

// ---- 全局可见性（接线）----
ok('char? 在全局可见', typeof run('char?') === 'function');
ok('sorted? 在全局可见', typeof run('sorted?') === 'function');

console.log(`char?/sorted?: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
