// _doto_test.js — Sibilant doto (ci287) 单元测试 + 隐性问题(nth 负索引)验证
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- doto (特殊形式，线程副作用) ----
ok('doto 返回原值', run('(doto 5 (+ 1))') === 5);
ok('doto 对 atom 累计副作用', run('(let ((a (atom 0))) (doto a (swap! + 1) (swap! + 2)) (deref a))') === 3);
ok('doto 多步顺序', run('(let ((a (atom 0))) (doto a (swap! + 10) (swap! + 5) (swap! * 2)) (deref a))') === 30);

// ---- R2 隐性问题：nth/list-ref 负索引曾通过 JS 回绕到末尾，现在统一返回() ----
ok('nth 负索引返回()', lispStr(run('(nth (list 1 2 3) -1)')) === '()');
ok('nth 越界返回()', lispStr(run('(nth (list 1 2 3) 9)')) === '()');
ok('nth 正常取值', run('(nth (list 1 2 3) 1)') === 2);
ok('list-ref 负索引返回()', lispStr(run('(list-ref (list 1 2 3) -5)')) === '()');

console.log(`doto: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
