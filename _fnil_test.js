// _fnil_test.js — Sibilant fnil / trampoline 单元测试
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- fnil ----
ok('fnil 替换第一个 nil(空列表)', run('((fnil + 1) () 2)') === 3);
ok('fnil 替换第二个 nil(空列表)', run('((fnil + 1 10) 5 ())') === 15);
ok('fnil 无 nil 透传', run('((fnil + 1) 5 5)') === 10);
ok('fnil 三个默认拼串', run('((fnil str "a" "b" "c") () () ())') === 'abc');
ok('fnil 默认不替换非 nil', run('((fnil str "x") "y")') === 'y');
ok('fnil 返回的是函数', typeof run('(fnil + 1)') === 'function');

// ---- trampoline ----
ok('trampoline 直接值透传', run('(trampoline (lambda (x) x) 42)') === 42);
ok('trampoline 单层 thunk', run('(trampoline (lambda (x) (lambda () (+ x 1))) 41)') === 42);
ok('trampoline 深度递归(10000 层 thunk)不爆栈', run('(define (step n) (if (= n 0) 0 (lambda () (step (- n 1))))) (trampoline step 10000)') === 0);

// ---- 全局可见性（接线）----
ok('fnil 在全局可见', typeof run('fnil') === 'function');
ok('trampoline 在全局可见', typeof run('trampoline') === 'function');

console.log(`fnil/trampoline: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
