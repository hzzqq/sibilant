// ci159 — Sibilant 数值统计/工具函数组：sum/product/mean/median/variance/stdev/clamp/lerp
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');

// 复用 lang 测试既有的运行入口：new Function(code)(...) 后通过 global.window.Sibilant.run
global.window = {};
new Function(code)(/* no args; interpreter attaches to window */);

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
function run(src) { return S.run(src); }

// ---- sum ----
eq('sum empty', run('(sum (list))'), 0);
eq('sum ints', run('(sum (list 1 2 3 4))'), 10);
eq('sum neg', run('(sum (list -1 1 -2 2))'), 0);
eq('sum nonnum->0', run('(sum (list 1 "x" 2))'), 3);
eq('sum nonlist', run('(sum 5)'), 0);

// ---- product ----
eq('product empty', run('(product (list))'), 1);
eq('product ints', run('(product (list 2 3 4))'), 24);
eq('product zero', run('(product (list 2 0 5))'), 0);
eq('product nonnum->0', run('(product (list 2 "x" 3))'), 0);

// ---- mean ----
near('mean basic', run('(mean (list 1 2 3 4))'), 2.5);
near('mean repeat', run('(mean (list 5 5 5))'), 5);
eq('mean empty', run('(mean (list))'), 0);
eq('mean nonlist', run('(mean 3)'), 0);

// ---- median ----
eq('median odd', run('(median (list 3 1 2))'), 2);
near('median even', run('(median (list 4 1 3 2))'), 2.5);
eq('median one', run('(median (list 7))'), 7);
eq('median empty', run('(median (list))'), 0);

// ---- variance (sample, n-1) ----
// 已知数据集 [2,4,4,4,5,5,7,9] 样本方差 = 32/7 ≈ 4.571428571428571
near('variance known', run('(variance (list 2 4 4 4 5 5 7 9))'), 32/7);
eq('variance one', run('(variance (list 5))'), 0);
eq('variance empty', run('(variance (list))'), 0);

// ---- stdev ----
near('stdev known', run('(stdev (list 2 4 4 4 5 5 7 9))'), Math.sqrt(32/7));
eq('stdev one', run('(stdev (list 5))'), 0);

// ---- clamp ----
eq('clamp hi', run('(clamp 15 0 10)'), 10);
eq('clamp lo', run('(clamp -3 0 10)'), 0);
eq('clamp mid', run('(clamp 5 0 10)'), 5);
eq('clamp equal', run('(clamp 10 0 10)'), 10);

// ---- lerp ----
eq('lerp mid', run('(lerp 0 10 0.5)'), 5);
eq('lerp quarter', run('(lerp 0 100 0.25)'), 25);
eq('lerp ends', run('(lerp 0 10 0)'), 0);
eq('lerp full', run('(lerp 0 10 1)'), 10);
eq('lerp neg', run('(lerp 10 0 0.25)'), 7.5);

// ---- 接线：doc 注册（doc 收到的是函数值而非符号，需用字符串/引号查询）----
eq('doc sum', S.run('(doc "sum")') !== null, true);
eq('doc stdev', S.run('(doc "stdev")') !== null, true);

console.log(`lang/_stats_test.js  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
