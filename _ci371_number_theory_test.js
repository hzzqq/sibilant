// ci371 — Sibilant 数论批次：gcd / lcm / factorial / is-prime / divisors
// 隐性修复：既有 gcd/lcm 补 doc 且对非有限数返回 null（此前对非法输入返回 NaN）
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
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error(`FAIL ${name}`); } }
function run(src) { return S.run(src); }

// ---------- gcd (改进) ----------
eq('gcd 12 18', run('(gcd 12 18)'), 6);
eq('gcd -8 12', run('(gcd -8 12)'), 4);
eq('gcd 0 7', run('(gcd 0 7)'), 7);
eq('gcd 小数截断', run('(gcd 1.5 3)'), 1);
eq('gcd 非有限 -> null', run('(gcd "abc" 3)'), null);

// ---------- lcm (改进) ----------
eq('lcm 4 6', run('(lcm 4 6)'), 12);
eq('lcm 0 5', run('(lcm 0 5)'), 0);
eq('lcm 非有限 -> null', run('(lcm "x" 5)'), null);

// ---------- factorial (既有) ----------
eq('factorial 5', run('(factorial 5)'), 120);
eq('factorial 0', run('(factorial 0)'), 1);

// ---------- is-prime (既有) ----------
eq('is-prime 7', run('(is-prime 7)'), true);
eq('is-prime 9', run('(is-prime 9)'), false);
eq('is-prime 1', run('(is-prime 1)'), false);
eq('is-prime 2', run('(is-prime 2)'), true);

// ---------- divisors (新增) ----------
eq('divisors 12', run('(divisors 12)'), [1, 2, 3, 4, 6, 12]);
eq('divisors 7', run('(divisors 7)'), [1, 7]);
eq('divisors 1', run('(divisors 1)'), [1]);
eq('divisors 负数 -> 空', run('(divisors -3)'), []);
eq('divisors 0 -> 空', run('(divisors 0)'), []);

// ---------- 隐性修复验证 ----------
ok('gcd 文档存在', (() => { const d = run('(doc "gcd")'); return typeof d === 'string' && d.length > 0; })());
ok('lcm 文档存在', (() => { const d = run('(doc "lcm")'); return typeof d === 'string' && d.length > 0; })());

console.log(`ci371(number-theory): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
