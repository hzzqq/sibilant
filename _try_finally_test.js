// _try_finally_test.js — Sibilant try/finally (ci307) 单元测试 + 隐性问题(reverse/last 缺失文档)验证
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- try ... finally (特殊形式扩展) ----
ok('try/finally 无异常 finally 执行', run('(let ((a (atom 0))) (try (swap! a + 5) (finally (swap! a + 2))) (deref a))') === 7);
ok('try/finally+catch finally 仍执行', run('(let ((a (atom 0))) (try (/ 1 0) (catch e (swap! a + 100)) (finally (swap! a + 1))) (deref a))') === 101);
ok('try/catch 向后兼容', run('(try (/ 1 0) (catch e 42))') === 42);
ok('try/finally 异常透传', (function(){ try { run('(try (/ 1 0) (finally (print "clean")))'); return false; } catch(e){ return /除以零/.test(e.message); } })());

// ---- R2 隐性问题：reverse/last 长期缺失自省文档，现已补全 ----
ok('reverse 文档可见(隐性补全)', run('(doc reverse)') !== '无文档');
ok('last 文档可见(隐性补全)', run('(doc last)') !== '无文档');
ok('reverse 功能正常', lispStr(run('(reverse (list 1 2 3))')) === '(3 2 1)');

console.log(`try/finally: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
