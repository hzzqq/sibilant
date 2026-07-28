// ci423 — Sibilant 树变换批：walk / postwalk / prewalk
// 隐性修复：update 与 conj 对 dict/set 原地修改入参（违反纯函数约定）-> 改为先克隆再写入。
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
global.require = require;
new Function(code)();

const S = global.window.Sibilant;
if (!S || typeof S.run !== 'function') { console.error('FAIL: runtime'); process.exit(1); }

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.error(`FAIL ${name}: got ${g}, want ${w}`); }
}
const run = (s) => S.run(s);

// ---- R1：树变换（自底向上 / 自顶向下 / 组合）----
// postwalk：每个节点都经 f，列表节点原样返回但其子已变换
eq('postwalk-inc', run('(postwalk (lambda (y) (if (list? y) y (if (number? y) (+ y 1) y))) (list 1 (list 2 3)))'), [2, [3, 4]]);
// prewalk：先 f 顶层，再下钻
eq('prewalk-inc', run('(prewalk (lambda (y) (if (number? y) (+ y 1) y)) (list 1 (list 2 3)))'), [2, [3, 4]]);
// walk：显式 identity 作为 inner，outer 数字 +1
eq('walk-inc', run('(walk (lambda (y) y) (lambda (y) (if (number? y) (+ y 1) y)) (list 1 (list 2 3)))'), [2, [3, 4]]);
// postwalk 亦作用于顶层原子
eq('postwalk-atom', run('(postwalk (lambda (y) (if (number? y) (* y 2) y)) 5)'), 10);

// ---- R2：纯函数修复（update / conj 不得修改入参；单次 run 内顺序求值）----
// update 应返回新 dict，原 d 不变
eq('update-pure', run('(begin (define d (dict (quote a) 1 (quote b) 2)) (define d2 (update d (quote a) (lambda (v) (+ v 100)))) (list (dict-get d (quote a)) (dict-get d2 (quote a))))'), [1, 101]);
// conj 对 dict 应返回新 dict，原 dd 不变
eq('conj-dict-pure', run('(begin (define dd (dict (quote a) 1)) (define dd2 (conj dd (list (quote b) 2))) (list (count dd) (count dd2)))'), [1, 2]);
// conj 对 set 应返回新 set，原 ss 不变
eq('conj-set-pure', run('(begin (define ss (set 1 2 3)) (define ss2 (conj ss 9)) (list (set-len ss) (set-len ss2)))'), [3, 4]);

console.log(`\nci423 walk/postwalk/prewalk: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
