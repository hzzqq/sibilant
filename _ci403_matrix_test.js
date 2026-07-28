// ci403 — Sibilant 矩阵批：matrix / matrix-get / matrix-set / matrix-map / matrix-transpose / matrix-mul
// 隐性修复：给未登记文档的内置 zip 补 doc 字符串（提升 help/doc 可发现性）。
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();

const S = global.window.Sibilant;
if (!S || typeof S.run !== 'function') { console.error('FAIL: runtime not attached'); process.exit(1); }

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.error(`FAIL ${name}: got ${g}, want ${w}`); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error(`FAIL ${name}`); } }
function run(src) { return S.run(src); }

// ---------- matrix ----------
eq('matrix 构造', run('(matrix (list (list 1 2) (list 3 4)))'), [[1,2],[3,4]]);
eq('matrix 单行包', run('(matrix (list 5))'), [[5]]);
eq('matrix 非数组 -> ()', run('(matrix 5)'), []);

// ---------- matrix-get ----------
eq('matrix-get 基本', run('(matrix-get (matrix (list (list 1 2) (list 3 4))) 1 0)'), 3);
eq('matrix-get 越界 -> null', run('(matrix-get (matrix (list (list 1 2))) 5 5)'), null);

// ---------- matrix-set（不改原矩阵）----------
eq('matrix-set 基本', run('(matrix-get (matrix-set (matrix (list (list 1 2))) 0 1 9) 0 1)'), 9);
ok('matrix-set 不改原矩阵', (() => { run('(let ((m (matrix (list (list 1 2))))) (matrix-set m 0 1 9) m)'); return JSON.stringify(run('(let ((m (matrix (list (list 1 2))))) (matrix-set m 0 1 9) m)')) === JSON.stringify([[1,2]]); })());

// ---------- matrix-map ----------
eq('matrix-map 乘2', run('(matrix-map (lambda (x) (* x 2)) (matrix (list (list 1 2) (list 3 4))))'), [[2,4],[6,8]]);

// ---------- matrix-transpose ----------
eq('matrix-transpose 2x2', run('(matrix-transpose (matrix (list (list 1 2) (list 3 4))))'), [[1,3],[2,4]]);
eq('matrix-transpose 非矩形补 null', run('(matrix-transpose (matrix (list (list 1 2 3) (list 4 5))))'), [[1,4],[2,5],[3,null]]);

// ---------- matrix-mul ----------
eq('matrix-mul 2x2', run('(matrix-mul (matrix (list (list 1 2) (list 3 4))) (matrix (list (list 5 6) (list 7 8))))'), [[19,22],[43,50]]);
eq('matrix-mul 维度不符 -> null', run('(matrix-mul (matrix (list (list 1 2 3))) (matrix (list (list 1 2))))'), null);
eq('matrix-mul 非数组 -> null', run('(matrix-mul 5 (matrix (list (list 1))))'), null);
// 组合：mul 后 transpose 等价
eq('组合 (transpose (mul A B))', run('(matrix-transpose (matrix-mul (matrix (list (list 1 2) (list 3 4))) (matrix (list (list 5 6) (list 7 8)))))'), run('(matrix-mul (matrix-transpose (matrix (list (list 5 6) (list 7 8)))) (matrix-transpose (matrix (list (list 1 2) (list 3 4)))))'));

// ---------- 文档存在性 ----------
['matrix','matrix-get','matrix-set','matrix-map','matrix-transpose','matrix-mul'].forEach(n => ok('doc '+n+' 存在', typeof run('(doc "'+n+'")') === 'string'));

// ---------- 隐性修复验证：zip 文档 ----------
ok('zip 文档已补登', typeof run('(doc "zip")') === 'string');
ok('zip 行为仍正确', JSON.stringify(run('(zip (list 1 2) (list 3 4))')) === JSON.stringify([[1,3],[2,4]]));

console.log(`ci403(matrix): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
