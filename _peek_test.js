// ci235 — Sibilant 列表首/栈/拼接/循环：peek / pop / list* / rotate
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL:', n); } };

// peek：取首元素
ok('peek (1 2 3) => 1', run('(peek (list 1 2 3))') === 1);
ok('peek (5 6) => 5', run('(peek (list 5 6))') === 5);
ok('peek 空列表 => null', run('(peek (list))') === null);

// pop：弹出首元素
ok('pop (1 2 3) => (2 3)', lispStr(run('(pop (list 1 2 3))')) === '(2 3)');
ok('pop (1) => ()', lispStr(run('(pop (list 1))')) === '()');
ok('pop 空列表 => ()', lispStr(run('(pop (list))')) === '()');
ok('pop 不改原列表', lispStr(run('(let ((c (list 1 2 3))) (pop c) c)')) === '(1 2 3)');

// list*：末参为列表则展开拼接
ok('list* 1 2 (3 4) => (1 2 3 4)', lispStr(run('(list* 1 2 (list 3 4))')) === '(1 2 3 4)');
ok('list* (1 2) => (1 2)', lispStr(run('(list* (list 1 2))')) === '(1 2)');
ok('list* 1 => (1)', lispStr(run('(list* 1)')) === '(1)');
ok('list* 1 2 3 => (1 2 3)', lispStr(run('(list* 1 2 3)')) === '(1 2 3)');
ok('list* 空 => ()', lispStr(run('(list*)')) === '()');

// rotate：循环左移（负为右移）
ok('rotate 1 (1 2 3 4) => (2 3 4 1)', lispStr(run('(rotate 1 (list 1 2 3 4))')) === '(2 3 4 1)');
ok('rotate 2 (1 2 3 4) => (3 4 1 2)', lispStr(run('(rotate 2 (list 1 2 3 4))')) === '(3 4 1 2)');
ok('rotate 0 (1 2 3) => (1 2 3)', lispStr(run('(rotate 0 (list 1 2 3))')) === '(1 2 3)');
ok('rotate -1 (1 2 3 4) => (4 1 2 3)', lispStr(run('(rotate -1 (list 1 2 3 4))')) === '(4 1 2 3)');
ok('rotate 5 (1 2 3) => (3 1 2)', lispStr(run('(rotate 5 (list 1 2 3))')) === '(3 1 2)');

// ---- 接线检查 ----
const src = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
ok("interpreter.js 定义 peek", /def\('peek'/.test(src));
ok("interpreter.js 定义 pop", /def\('pop'/.test(src));
ok("interpreter.js 定义 list*", /def\('list\*'/.test(src));
ok("interpreter.js 定义 rotate", /def\('rotate'/.test(src));

console.log(`peek: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
