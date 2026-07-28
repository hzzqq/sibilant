// ci407 — Sibilant 聚合/折叠批：reduce-right / split-by（reduce / foldl1 / foldr1 / count-where 已存在）
// 隐性修复：给 reduce 补 doc；修正 foldl1 doc 文案（空列表返回 null 而非 ()）。
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

// ---------- reduce（已存在，验证 + doc）----------
eq('reduce 基本', run('(reduce + 0 (list 1 2 3 4))'), 10);
eq('reduce 非空列表', run('(reduce * 1 (list 2 3 4))'), 24);
eq('reduce 非数组 -> init', run('(reduce + 99 5)'), 99);
ok('reduce 文档已补登', typeof run('(doc "reduce")') === 'string');

// ---------- reduce-right（新增）----------
eq('reduce-right 字符串拼接', run('(reduce-right (lambda (x a) (str x a)) "" (list "a" "b" "c"))'), 'abc');
eq('reduce-right 数值', run('(reduce-right (lambda (x a) (- x a)) 0 (list 1 2 3))'), 2);
eq('reduce-right 非数组 -> init', run('(reduce-right + 7 5)'), 7);
ok('reduce-right 文档存在', typeof run('(doc "reduce-right")') === 'string');

// ---------- foldl1 / foldr1（已存在）----------
eq('foldl1 基本', run('(foldl1 + (list 1 2 3 4))'), 10);
eq('foldl1 空 -> null', run('(foldl1 + (list))'), null);
eq('foldr1 列表嵌套', run('(foldr1 (lambda (a b) (list a b)) (list 1 2 3))'), [1,[2,3]]);
eq('foldr1 空 -> null', run('(foldr1 + (list))'), null);
ok('foldl1 doc 文案已纠正为 null', (() => { const d = run('(doc "foldl1")'); return typeof d === 'string' && d.indexOf('null') >= 0; })());

// ---------- count-where（已存在）----------
eq('count-where even', run('(count-where even? (list 1 2 3 4))'), 2);
eq('count-where 非数组 -> 0', run('(count-where even? 5)'), 0);

// ---------- split-by（新增，避开 chunk 版 partition 重名）----------
eq('split-by even/not', run('(split-by even? (list 1 2 3 4))'), [[2,4],[1,3]]);
eq('split-by 全命中', run('(split-by (lambda (x) (> x 0)) (list 1 2 3))'), [[1,2,3],[]]);
eq('split-by 非数组 -> (( ) ( ))', run('(split-by even? 5)'), [[],[]]);
ok('split-by 文档存在', typeof run('(doc "split-by")') === 'string');

// ---------- 组合：reduce 与 foldl1 等价（可结合运算）----------
eq('组合 reduce+init0 == foldl1', run('(reduce + 0 (list 1 2 3 4 5))'), run('(foldl1 + (list 1 2 3 4 5))'));

console.log(`ci407(aggregate): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
