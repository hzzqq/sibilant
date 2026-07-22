// _when_let_test.js — Sibilant when-let (ci279) 单元测试 + 隐性问题(range step 0)验证
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- when-let (特殊形式) ----
ok('when-let 绑定非nil 运行体', run('(when-let (x (car (list 5 6))) (+ x 1))') === 6);
ok('when-let 绑定nil 返回()', lispStr(run('(when-let (x (car (list))) 99)')) === '()');
ok('when-let 零非nil 运行体', run('(when-let (x (car (list 0))) "ok")') === 'ok');
ok('when-let 多步体取末值', run('(when-let (x (car (list 7))) (inc x) (* x 2))') === 14);

// ---- R2 隐性问题：range step 0 之前静默返回空，现在抛错防止死循环式误用 ----
let threw = false;
try { run('(range 0 10 0)'); } catch(e){ threw = true; }
ok('range step 0 抛错(隐性问题已修)', threw);
ok('range 正常仍可用', lispStr(run('(range 3)')) === '(0 1 2)');

console.log(`when-let: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
