// ci339 — Sibilant 统计/向量批次：covariance / correlation / zscore / softmax / cosine-sim
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

// ---- covariance ----
near('covariance 完全线性', run('(covariance (list 1 2 3) (list 2 4 6))'), 2);
near('covariance 常数列为 0', run('(covariance (list 1 2 3) (list 5 5 5))'), 0);
near('covariance 负相关', run('(covariance (list 1 2 3) (list 3 2 1))'), -1);
eq('covariance 长度不符 -> 0', run('(covariance (list 1 2) (list 1 2 3))'), 0);
eq('covariance 不足 2 -> 0', run('(covariance (list 1) (list 2))'), 0);

// ---- correlation ----
near('correlation 完全正相关 1', run('(correlation (list 1 2 3) (list 2 4 6))'), 1);
near('correlation 完全负相关 -1', run('(correlation (list 1 2 3) (list 6 4 2))'), -1);
eq('correlation 零方差 -> 0', run('(correlation (list 1 2 3) (list 5 5 5))'), 0);
eq('correlation 长度不符 -> 0', run('(correlation (list 1 2) (list 1 2 3))'), 0);
{
  const r = run('(correlation (list 1 2 3 4 5) (list 2 1 4 3 5))');
  if (typeof r === 'number' && r > 0 && r < 1) { pass++; } else { fail++; console.error('FAIL correlation 部分相关应在 (0,1): ' + r); }
}

// ---- zscore ----
nearList('zscore 等差列', run('(zscore (list 1 2 3))'), [-1, 0, 1]);
nearList('zscore 零方差 -> 全 0', run('(zscore (list 5 5 5))'), [0, 0, 0]);
eq('zscore 不足 2 -> 全 0', run('(zscore (list 7))'), [0]);
{
  const r = run('(zscore (list 2 4 4 4 5 5 7 9))');
  const m = r.reduce((s, v) => s + v, 0) / r.length;
  if (Math.abs(m) < 1e-9) { pass++; } else { fail++; console.error('FAIL zscore 均值应为 0: ' + m); }
}

// ---- softmax ----
nearList('softmax 对称二元', run('(softmax (list 0 0))'), [0.5, 0.5]);
{
  const r = run('(softmax (list 1 2 3))');
  const s = r.reduce((a, v) => a + v, 0);
  if (Math.abs(s - 1) < 1e-9 && r[2] > r[1] && r[1] > r[0]) { pass++; } else { fail++; console.error('FAIL softmax 和为 1 且单调: ' + JSON.stringify(r)); }
}
{
  const r = run('(softmax (list 1000 1000))');   // 减最大值防溢出
  nearList('softmax 大数不溢出', r, [0.5, 0.5]);
}
eq('softmax 空列表 -> 空', run('(softmax (list))'), []);

// ---- cosine-sim ----
near('cosine-sim 正交 0', run('(cosine-sim (list 1 0) (list 0 1))'), 0);
near('cosine-sim 平行 1', run('(cosine-sim (list 1 2) (list 2 4))'), 1);
near('cosine-sim 反向 -1', run('(cosine-sim (list 1 0) (list -1 0))'), -1);
eq('cosine-sim 零向量 -> 0', run('(cosine-sim (list 0 0) (list 1 2))'), 0);
eq('cosine-sim 长度不符 -> 0', run('(cosine-sim (list 1) (list 1 2))'), 0);

// ---- 组合：与既有 stdlib 协作 ----
near('zscore + sum 组合', run('(sum (zscore (list 10 20 30)))'), 0);
near('correlation 自身为 1', run('(correlation (list 3 1 4 1 5) (list 3 1 4 1 5))'), 1);

console.log(`\n[Sibilant stats2] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
