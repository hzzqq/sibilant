// ci363 — Sibilant 字符串批次：slugify / str-trim / str-pad / str-repeat / str-reverse
// 隐性修复：string-split / string-replace 补 doc；string-replace 空 old 改为无操作(避免逐字符插入)
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

// ---------- slugify ----------
eq('slugify Hello World', run(String.raw`(slugify "Hello, World!")`), 'hello-world');
eq('slugify 多空格', run(String.raw`(slugify "  Foo  Bar  ")`), 'foo-bar');
eq('slugify 已干净', run(String.raw`(slugify "already-slug")`), 'already-slug');

// ---------- str-trim ----------
eq('str-trim 首尾', run(String.raw`(str-trim "  x  ")`), 'x');

// ---------- str-pad ----------
eq('str-pad 左补默认', run(String.raw`(str-pad "7" 3 "0")`), '007');
eq('str-pad 右补', run(String.raw`(str-pad "7" 3 "0" "right")`), '700');
eq('str-pad 两端补', run(String.raw`(str-pad "7" 3 "0" "both")`), '070');
eq('str-pad 已够长原样', run(String.raw`(str-pad "abcd" 3 "0")`), 'abcd');
eq('str-pad 负数长度原样', run(String.raw`(str-pad "x" -1 "0")`), 'x');
eq('str-pad 非字符串输入', run(String.raw`(str-pad 5 3 "0")`), '005');

// ---------- str-repeat ----------
eq('str-repeat 3 次', run(String.raw`(str-repeat "ab" 3)`), 'ababab');
eq('str-repeat 0 次', run(String.raw`(str-repeat "ab" 0)`), '');
eq('str-repeat 负数', run(String.raw`(str-repeat "ab" -1)`), '');
eq('str-repeat 非数字', run(String.raw`(str-repeat "ab" "x")`), '');

// ---------- str-reverse ----------
eq('str-reverse hello', run(String.raw`(str-reverse "hello")`), 'olleh');

// ---------- 隐性修复验证 ----------
ok('string-split 现在有 doc', (() => { const d = run('(doc "string-split")'); return typeof d === 'string' && d.length > 0; })());
ok('string-replace 现在有 doc', (() => { const d = run('(doc "string-replace")'); return typeof d === 'string' && d.length > 0; })());
eq('string-replace 空 old 无操作', run(String.raw`(string-replace "abc" "" "x")`), 'abc');
eq('string-replace 正常替换', run(String.raw`(string-replace "a-b-c" "-" "/")`), 'a/b/c');
eq('string-split 行为不变', run(String.raw`(string-split "a,b,c" ",")`).length, 3);

console.log(`ci363(string): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
