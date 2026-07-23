// ci375 — Sibilant 编码批次：base64-encode / base64-decode / url-encode / url-decode
// 隐性修复：digits 对非数字输入返回空列表(此前返回 [30 49 30] 垃圾值)
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

// ---------- base64 ----------
eq('base64-encode hello', run(String.raw`(base64-encode "hello")`), 'aGVsbG8=');
eq('base64-decode hello', run(String.raw`(base64-decode "aGVsbG8=")`), 'hello');
eq('base64 往返(含中文)', run(String.raw`(base64-decode (base64-encode "Hello, 世界!"))`), 'Hello, 世界!');
eq('base64 往返(数字输入)', run(String.raw`(base64-decode (base64-encode 123))`), '123');

// ---------- url ----------
eq('url-encode 空格与&', run(String.raw`(url-encode "a b&c")`), 'a%20b%26c');
eq('url-decode %20', run(String.raw`(url-decode "a%20b")`), 'a b');
eq('url 往返', run(String.raw`(url-decode (url-encode "a/b?c=d&e"))`), 'a/b?c=d&e');

// ---------- 隐性修复 digits ----------
eq('digits 123', run('(digits 123)'), [1, 2, 3]);
eq('digits -45', run('(digits -45)'), [4, 5]);
eq('digits 0', run('(digits 0)'), [0]);
eq('digits 非数字 -> 空', run('(digits "abc")'), []);
eq('digits 非有限 -> 空', run('(digits "x")'), []);
ok('digits 文档已更新', (() => { const d = run('(doc "digits")'); return typeof d === 'string' && d.indexOf('空列表') >= 0; })());

console.log(`ci375(encoding): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
