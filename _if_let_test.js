// _if_let_test.js — Sibilant if-let (ci283) 单元测试 + 隐性问题(apply 非列表)验证
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- if-let (特殊形式) ----
ok('if-let 真分支', run('(if-let (x (car (list 7))) x 0)') === 7);
ok('if-let 空列表走假分支', run('(if-let (x (car (list))) x 0)') === 0);
ok('if-let 显式nil走假分支', run('(if-let (x (if #f 1 #f)) x 99)') === 99);
ok('if-let 假分支多表单取末值', run('(if-let (x (car (list))) 1 2 3)') === 3);

// ---- R2 隐性问题：apply 第二参数非列表时之前静默当空，现在明确报错 ----
let threw = false;
try { run('(apply + 5)'); } catch(e){ threw = true; }
ok('apply 非列表抛错(隐性问题已修)', threw);
ok('apply 列表正常', run('(apply + (list 1 2 3))') === 6);

console.log(`if-let: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
