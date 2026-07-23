// ci367 — Sibilant 集合批次：subset? / superset? / disjoint? / symmetric-diff（list 与 set 多态）
// 隐性修复：subset?/superset? 由「仅 LSet」扩展为「set 与 list 同类型均可」，mixed/非集合仍抛错（保持既有测试）
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
function throws(src) { try { run(src); return false; } catch (e) { return true; } }

// ---------- subset? ----------
eq('subset? list⊆list 真', run('(subset? (list 1 2) (list 1 2 3))'), true);
eq('subset? list⊆list 假', run('(subset? (list 1 2 3) (list 1 2))'), false);
eq('subset? list 空集', run('(subset? (list) (list 1 2))'), true);
eq('subset? set⊆set 真', run('(subset? (set 1) (set 1 2))'), true);
eq('subset? set⊆set 假', run('(subset? (set 1 2) (set 1))'), false);
ok('subset? 混合类型仍抛错(向后兼容)', throws('(subset? (list 1) (set 1))'));

// ---------- superset? ----------
eq('superset? list⊇list 真', run('(superset? (list 1 2 3) (list 2))'), true);
eq('superset? list⊇list 假', run('(superset? (list 1) (list 1 2))'), false);
eq('superset? set⊇set 真', run('(superset? (set 1 2 3) (set 2))'), true);
eq('superset? set 空集是其超集', run('(superset? (set 1 2 3) (set))'), true);
ok('superset? 混合类型仍抛错', throws('(superset? (list 1) (set 1))'));

// ---------- disjoint? ----------
eq('disjoint? list 不相交', run('(disjoint? (list 1 2) (list 3 4))'), true);
eq('disjoint? list 相交', run('(disjoint? (list 1 2) (list 2 3))'), false);
eq('disjoint? set 相交', run('(disjoint? (set 1 2) (set 2 3))'), false);
eq('disjoint? 非集合输入', run('(disjoint? 5 (list 1))'), false);

// ---------- symmetric-diff ----------
eq('symmetric-diff list', run('(symmetric-diff (list 1 2 3) (list 2 3 4))'), [1, 4]);
eq('symmetric-diff set', run('(symmetric-diff (set 1 2 3) (set 2 3 4))'), [1, 4]);
eq('symmetric-diff 去重', run('(symmetric-diff (list 1 1 2) (list 2 3))'), [1, 3]);
eq('symmetric-diff 非集合输入', run('(symmetric-diff 5 (list 1))'), []);

// ---------- 隐性修复验证 ----------
ok('subset? 文档存在', (() => { const d = run('(doc "subset?")'); return typeof d === 'string' && d.indexOf('多态') >= 0; })());
ok('superset? 文档存在', (() => { const d = run('(doc "superset?")'); return typeof d === 'string' && d.length > 0; })());
ok('disjoint? 文档存在', (() => { const d = run('(doc "disjoint?")'); return typeof d === 'string' && d.length > 0; })());
ok('symmetric-diff 文档存在', (() => { const d = run('(doc "symmetric-diff")'); return typeof d === 'string' && d.length > 0; })());

console.log(`ci367(set): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
