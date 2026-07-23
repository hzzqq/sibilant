// ci387 — Sibilant 列表扩展批：chunk / flatten-once（take / drop / interleave 已存在）
// 隐性修复：partition 在 n<=0 时 `(drop xs 0)` 不变导致无限递归 -> 补 (or (null? xs) (<= n 0)) 守卫。
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

// ---------- take / drop / interleave（已存在）----------
eq('take 前2', run('(take (list 1 2 3 4) 2)'), [1, 2]);
eq('take 0 -> 空', run('(take (list 1 2 3) 0)'), []);
eq('drop 前2', run('(drop (list 1 2 3 4) 2)'), [3, 4]);
eq('interleave 两轮', run('(interleave (list 1 2) (list 3 4 5))'), [1, 3, 2, 4, 5]);
eq('interleave 空参 -> 空', run('(interleave)'), []);

// ---------- chunk（新增）----------
eq('chunk 定长', run('(chunk (list 1 2 3 4 5) 2)'), [[1, 2], [3, 4], [5]]);
eq('chunk 整除', run('(chunk (list 1 2 3 4) 2)'), [[1, 2], [3, 4]]);
eq('chunk n=0 -> 空', run('(chunk (list 1 2 3) 0)'), []);
eq('chunk 非数组 -> 空', run('(chunk "x" 2)'), []);
eq('chunk 负 n -> 空', run('(chunk (list 1 2 3) -1)'), []);

// ---------- flatten-once（新增）----------
eq('flatten-once 单层', run('(flatten-once (list 1 (list 2 3) (list 4)))'), [1, 2, 3, 4]);
eq('flatten-once 不递归', run('(flatten-once (list 1 (list (list 2))))'), [1, [2]]);
eq('flatten-once 非数组 -> 空', run('(flatten-once 5)'), []);
eq('flatten-once 与平面 flatten 对比', run('(flatten (list 1 (list (list 2))))'), [1, 2]);

// ---------- 隐性修复验证：partition n<=0 不再无限递归 ----------
let noStackOverflow = true;
try { run('(partition 0 (list 1 2 3))'); run('(partition -2 (list 1 2 3))'); } catch (e) { noStackOverflow = false; }
ok('partition n=0 不爆栈', noStackOverflow);
eq('partition n=0 -> 空块', run('(partition 0 (list 1 2 3))'), []);
eq('partition 正常', run('(partition 2 (list 1 2 3 4 5))'), [[1, 2], [3, 4], [5]]);

// ---------- 文档登记 ----------
ok('doc take', typeof run('(doc "take")') === 'string');
ok('doc chunk', (() => { const d = run('(doc "chunk")'); return typeof d === 'string' && d.indexOf('分块') >= 0; })());
ok('doc flatten-once', (() => { const d = run('(doc "flatten-once")'); return typeof d === 'string' && d.indexOf('单层') >= 0; })());

console.log(`ci387(list): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
