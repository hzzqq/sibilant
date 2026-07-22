// ci219 — Sibilant 可变状态原子：atom / deref / reset! / swap!
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c)=> { if(c) pass++; else { fail++; console.log('  FAIL:', n); } };

// 创建 + 取值
ok('atom 创建并 deref', run('(let ((a (atom 10))) (deref a))') === 10);
ok('atom 默认 nil', run('(deref (atom))') === null);
// reset!
ok('reset! 设值并返回', run('(let ((a (atom 1))) (reset! a 42))') === 42);
ok('reset! 后 deref 见新值', run('(let ((a (atom 1))) (reset! a 42) (deref a))') === 42);
// swap! 算术
ok('swap! +', run('(let ((a (atom 10))) (swap! a + 3) (deref a))') === 13);
ok('swap! *', run('(let ((a (atom 10))) (swap! a * 2) (deref a))') === 20);
ok('swap! 返回新值', run('(let ((a (atom 1))) (swap! a + 4))') === 5);
// swap! 带 lambda
ok('swap! lambda', run('(let ((a (atom 10))) (swap! a (lambda (v) (+ v 100))) (deref a))') === 110);
// swap! 操作列表原子
ok('swap! 列表 cons', lispStr(run('(let ((b (atom (list 1 2)))) (swap! b (lambda (x) (cons 0 x))) (deref b))')) === '(0 1 2)');
// 多次 swap 累积
ok('swap! 累积', run('(let ((a (atom 0))) (swap! a + 1) (swap! a + 1) (swap! a + 1) (deref a))') === 3);
// 错误：deref/reset!/swap! 需要 atom
ok('deref 非 atom 报错', (()=>{ try { run('(deref 5)'); return false; } catch(e){ return true; } })());
ok('swap! 非 atom 报错', (()=>{ try { run('(swap! 5 + 1)'); return false; } catch(e){ return true; } })());

console.log(`atom: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
