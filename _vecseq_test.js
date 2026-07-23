// ci343/ci347/ci351/ci355 — Sibilant 四批 stdlib：
//   ci343 向量：dot-product / magnitude / normalize / euclidean / manhattan
//   ci347 序列：cumsum / cumprod / diff-list / moving-avg / ema
//   ci351 字符串/频次：levenshtein / hamming / char-freq / mode / histogram
//   ci355 稳健统计：mad / winsorize / rank-list / geomean / harmonic-mean
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');

global.window = {};
new Function(code)();

const S = global.window.Sibilant;
if (!S || typeof S.run !== 'function') {
  console.error('FAIL: Sibilant runtime not attached to window');
  process.exit(1);
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${g}, want ${w}`); }
}
function near(name, got, want, eps = 1e-9) {
  if (typeof got === 'number' && Math.abs(got - want) <= eps) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${got}, want ~${want}`); }
}
function nearList(name, got, want, eps = 1e-9) {
  if (Array.isArray(got) && got.length === want.length && got.every((v, i) => Math.abs(v - want[i]) <= eps)) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ~${JSON.stringify(want)}`); }
}
function run(src) { return S.run(src); }

// ---------- ci343 向量 ----------
eq('dot-product 基本', run('(dot-product (list 1 2 3) (list 4 5 6))'), 32);
eq('dot-product 长度不符=0', run('(dot-product (list 1 2) (list 1))'), 0);
eq('dot-product 正交=0', run('(dot-product (list 1 0) (list 0 1))'), 0);
near('magnitude 3-4-5', run('(magnitude (list 3 4))'), 5);
eq('magnitude 空=0', run('(magnitude (list))'), 0);
nearList('normalize 3-4', run('(normalize (list 3 4))'), [0.6, 0.8]);
nearList('normalize 零向量全0', run('(normalize (list 0 0 0))'), [0, 0, 0]);
near('normalize 后模长=1', run('(magnitude (normalize (list 5 12)))'), 1);
near('euclidean 3-4-5', run('(euclidean (list 0 0) (list 3 4))'), 5);
eq('euclidean 同点=0', run('(euclidean (list 1 2) (list 1 2))'), 0);
eq('manhattan 基本', run('(manhattan (list 0 0) (list 3 4))'), 7);
eq('manhattan 负数取绝对值', run('(manhattan (list -1 -2) (list 1 2))'), 6);
// 组合：cosine-sim(既有) = dot/(mag*mag)
near('组合 cosine=dot/(magA*magB)',
  run('(/ (dot-product (list 1 2) (list 3 4)) (* (magnitude (list 1 2)) (magnitude (list 3 4))))'),
  run('(cosine-sim (list 1 2) (list 3 4))'));

// ---------- ci347 序列 ----------
eq('cumsum 基本', run('(cumsum (list 1 2 3 4))'), [1, 3, 6, 10]);
eq('cumsum 空', run('(cumsum (list))'), []);
eq('cumprod 基本', run('(cumprod (list 1 2 3 4))'), [1, 2, 6, 24]);
eq('cumprod 含0截断', run('(cumprod (list 2 0 5))'), [2, 0, 0]);
eq('diff-list 基本', run('(diff-list (list 1 4 9 16))'), [3, 5, 7]);
eq('diff-list 单元素=空', run('(diff-list (list 7))'), []);
nearList('moving-avg w=2', run('(moving-avg (list 1 2 3 4) 2)'), [1.5, 2.5, 3.5]);
eq('moving-avg n<w=空', run('(moving-avg (list 1 2) 3)'), []);
nearList('moving-avg w=1 恒等', run('(moving-avg (list 5 6 7) 1)'), [5, 6, 7]);
eq('ema alpha=1 恒等', run('(ema (list 1 2 3) 1)'), [1, 2, 3]);
nearList('ema alpha=0.5', run('(ema (list 4 8) 0.5)'), [4, 6]);
nearList('ema alpha=0 恒首项', run('(ema (list 3 9 27) 0)'), [3, 3, 3]);
// 组合：diff-list(cumsum xs) == 尾部原样
eq('组合 diff∘cumsum 还原尾部', run('(diff-list (cumsum (list 5 7 9)))'), [7, 9]);

// ---------- ci351 字符串/频次 ----------
eq('levenshtein kitten/sitting', run('(levenshtein "kitten" "sitting")'), 3);
eq('levenshtein 相同=0', run('(levenshtein "abc" "abc")'), 0);
eq('levenshtein 空串=长度', run('(levenshtein "" "abcd")'), 4);
eq('hamming 基本', run('(hamming "karolin" "kathrin")'), 3);
eq('hamming 长度不同=-1', run('(hamming "ab" "abc")'), -1);
eq('hamming 相同=0', run('(hamming "xyz" "xyz")'), 0);
eq('char-freq a 计数', run('(dict-get (char-freq "aab") "a")'), 2);
eq('char-freq b 计数', run('(dict-get (char-freq "aab") "b")'), 1);
eq('char-freq 字典大小', run('(dict-len (char-freq "banana"))'), 3);
eq('char-freq banana n 计数', run('(dict-get (char-freq "banana") "n")'), 2);
eq('mode 基本', run('(mode (list 1 2 2 3))'), 2);
eq('mode 并列取最先', run('(mode (list 3 1 3 1))'), 3);
eq('mode 空=null', run('(mode (list))'), null);
eq('histogram 等宽两桶', run('(histogram (list 1 2 3 4) 2)'), [2, 2]);
eq('histogram 全相同落首桶', run('(histogram (list 5 5 5) 3)'), [3, 0, 0]);
eq('histogram 计数守恒', run('(histogram (list 1 9 2 8 5) 4)').reduce((s, v) => s + v, 0), 5);

// ---------- ci355 稳健统计 ----------
eq('mad 基本', run('(mad (list 1 1 2 2 4 6 9))'), 1);
eq('mad 常数列=0', run('(mad (list 5 5 5))'), 0);
eq('winsorize 两端钳位', run('(winsorize (list 1 5 6 7 100) 0.2)'), [5, 5, 6, 7, 7]);
eq('winsorize p=0 恒等', run('(winsorize (list 3 1 2) 0)'), [3, 1, 2]);
eq('rank-list 基本', run('(rank-list (list 30 10 20))'), [3, 1, 2]);
eq('rank-list 并列平均秩', run('(rank-list (list 5 5 9))'), [1.5, 1.5, 3]);
near('geomean 2-8', run('(geomean (list 2 8))'), 4);
eq('geomean 含非正=0', run('(geomean (list 2 0 8))'), 0);
near('harmonic-mean 基本', run('(harmonic-mean (list 1 4 4))'), 2);
eq('harmonic-mean 含非正=0', run('(harmonic-mean (list 1 -2))'), 0);
// 组合：AM >= GM >= HM（正数列）
(() => {
  const am = run('(mean (list 2 3 7 9))');
  const gm = run('(geomean (list 2 3 7 9))');
  const hm = run('(harmonic-mean (list 2 3 7 9))');
  if (am >= gm && gm >= hm) { pass++; }
  else { fail++; console.error(`FAIL AM>=GM>=HM: am=${am} gm=${gm} hm=${hm}`); }
})();

console.log(`vecseq(ci343/347/351/355): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
