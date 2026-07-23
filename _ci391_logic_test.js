// ci391 — Sibilant 逻辑批：and? / or? / not? / xor? / implies?（严格布尔谓词）
// 隐性修复：and / or 宏此前缺 doc 字符串 -> 补登文档。
// 真值约定（与语言一致）：仅 false / null 为假，其余（含 0 / "" / () ）为真。
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

// ---------- and? ----------
eq('and? #t #t', run('(and? #t #t)'), true);
eq('and? #t #f', run('(and? #t #f)'), false);
eq('and? 非布尔双方真', run('(and? 5 "x")'), true);
eq('and? 含 #f', run('(and? 5 #f)'), false);

// ---------- or? ----------
eq('or? #f #t', run('(or? #f #t)'), true);
eq('or? #f #f', run('(or? #f #f)'), false);
eq('or? 非布尔任真', run('(or? 0 #f)'), true);

// ---------- not? ----------
eq('not? #f', run('(not? #f)'), true);
eq('not? #t', run('(not? #t)'), false);
eq('not? 5', run('(not? 5)'), false);
eq('not? () 非空假', run('(not? ())'), false);

// ---------- xor? ----------
eq('xor? 一真', run('(xor? #t #f)'), true);
eq('xor? 两真', run('(xor? #t #t)'), false);
eq('xor? 两假', run('(xor? #f #f)'), false);

// ---------- implies? ----------
eq('implies? 真->假 = 假', run('(implies? #t #f)'), false);
eq('implies? 假->真 = 真', run('(implies? #f #t)'), true);
eq('implies? 真->真 = 真', run('(implies? #t #t)'), true);
eq('implies? 假->假 = 真', run('(implies? #f #f)'), true);
eq('implies? 前件假即真', run('(implies? #f 5)'), true);

// ---------- 与既有宏对比（宏返回原值，谓词返回严格布尔）----------
eq('and 宏保留末值', run('(and #t 5)'), 5);
eq('or 宏保留首真', run('(or #f 5)'), 5);

// ---------- 隐性修复验证：and / or 文档 ----------
ok('doc and 已补登', (() => { const d = run('(doc "and")'); return typeof d === 'string' && d.indexOf('短路') >= 0; })());
ok('doc or 已补登', (() => { const d = run('(doc "or")'); return typeof d === 'string' && d.indexOf('短路') >= 0; })());
ok('doc not? 存在', (() => { const d = run('(doc "not?")'); return typeof d === 'string'; })());
ok('doc implies? 存在', (() => { const d = run('(doc "implies?")'); return typeof d === 'string' && d.indexOf('蕴含') >= 0; })());

console.log(`ci391(logic): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
