// ci383 — Sibilant 数学扩展批：map-range（lerp / clamp / round-to / sign 已存在）
// 隐性修复：clamp / lerp 此前对非有限数输入返回 NaN -> 改为返回 null。
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
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error(`FAIL ${name}`); } }
function run(src) { return S.run(src); }

// ---------- lerp（已存在）----------
near('lerp 基本', run('(lerp 0 10 0.5)'), 5);
near('lerp 0.25', run('(lerp 0 100 0.25)'), 25);
// ---------- clamp（已存在）----------
eq('clamp 上限', run('(clamp 15 0 10)'), 10);
eq('clamp 下限', run('(clamp -3 0 10)'), 0);
eq('clamp 区间中', run('(clamp 7 0 10)'), 7);
// ---------- round-to（已存在）----------
eq('round-to 5 下', run('(round-to 7 5)'), 5);
eq('round-to 5 上', run('(round-to 8 5)'), 10);
near('round-to 小数', run('(round-to 3.14159 0.01)'), 3.14);
// ---------- sign（已存在）----------
eq('sign 负', run('(sign -5)'), -1);
eq('sign 正', run('(sign 3)'), 1);
eq('sign 零', run('(sign 0)'), 0);

// ---------- map-range（新增）----------
near('map-range 正比', run('(map-range 5 0 10 0 100)'), 50);
near('map-range 起点', run('(map-range 0 0 10 0 100)'), 0);
near('map-range 终点', run('(map-range 10 0 10 0 100)'), 100);
near('map-range 反向区间', run('(map-range 5 0 10 20 30)'), 25);
near('map-range 负向', run('(map-range -5 -10 0 -100 0)'), -50);

// ---------- 隐性修复：clamp / lerp 非有限输入 -> null ----------
ok('clamp 非有限 -> null', run('(clamp "x" 0 10)') === null);
ok('clamp 非有限 hi -> null', run('(clamp 1 0 "x")') === null);
ok('lerp 非有限 -> null', run('(lerp "a" 1 0.5)') === null);
ok('lerp 非有限比例 -> null', run('(lerp 0 1 "x")') === null);
ok('map-range 非有限 -> null', run('(map-range "x" 0 10 0 100)') === null);

// ---------- 文档登记（既有 + 新增）----------
ok('doc lerp', typeof run('(doc "lerp")') === 'string');
ok('doc clamp', typeof run('(doc "clamp")') === 'string');
ok('doc map-range', (() => { const d = run('(doc "map-range")'); return typeof d === 'string' && d.indexOf('区间映射') >= 0; })());

console.log(`ci383(math): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
