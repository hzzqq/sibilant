// ci395 — Sibilant IO/JSON 批：json-parse / json-stringify / slurp（read-file / write-file 已存在）
// 隐性修复：read-file / write-file 此前缺 doc 字符串 -> 补登文档。
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
// 暴露 require 给 new Function 作用域（文件模式下 globalThis.require 默认不存在，
// 仅让 IO 类内置（read-file / write-file / slurp）可解析到 Node 的 require）。
global.require = require;
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

const TMP = path.join(__dirname, 'test_ci395_tmp.txt');

// ---------- read-file / write-file（已存在）----------
ok('read-file interpreter.js 非空', (() => { const s = run('(read-file "interpreter.js")'); return typeof s === 'string' && s.length > 0; })());
eq('write-file 返回 null', run(`(write-file "${TMP.replace(/\\/g, '/')}" "hello-ci395")`), null);
eq('write-file 后可 read-file', run(`(read-file "${TMP.replace(/\\/g, '/')}")`), 'hello-ci395');

// ---------- json-parse（新增）----------
eq('json-parse 对象取键', run('(dict-get (json-parse "{\\"a\\":1}") "a")'), 1);
eq('json-parse 数组->列表', run('(json-parse "[1,2,3]")'), [1, 2, 3]);
eq('json-parse 嵌套', run('(dict-get (json-parse "{\\"x\\":[1,2]}") "x")'), [1, 2]);
ok('json-parse 非法 -> null', run('(json-parse "not-json")') === null);

// ---------- json-stringify（新增）----------
eq('json-stringify 列表', run('(json-stringify (list 1 2))'), '[1,2]');
eq('json-stringify 字典', run('(json-stringify (dict (quote a) 1))'), '{"a":1}');
ok('json-stringify 非法 -> null', run('(json-stringify (lambda(x) x))') === null); // 函数不可序列化
eq('json 往返', run('(json-stringify (json-parse "{\\"a\\":[1,2]}"))'), '{"a":[1,2]}');

// ---------- slurp（新增，容错）----------
ok('slurp interpreter.js 非空', (() => { const s = run('(slurp "interpreter.js")'); return typeof s === 'string' && s.length > 0; })());
ok('slurp 不存在 -> null', run('(slurp "no_such_file_ci395.txt")') === null);

// ---------- 隐性修复验证：read-file / write-file 文档 ----------
ok('doc read-file 已补登', (() => { const d = run('(doc "read-file")'); return typeof d === 'string' && d.indexOf('读取') >= 0; })());
ok('doc write-file 已补登', (() => { const d = run('(doc "write-file")'); return typeof d === 'string' && d.indexOf('写入') >= 0; })());
ok('doc json-parse 存在', (() => { const d = run('(doc "json-parse")'); return typeof d === 'string'; })());
ok('doc slurp 存在', (() => { const d = run('(doc "slurp")'); return typeof d === 'string'; })());

// 清理临时文件
try { fs.unlinkSync(TMP); } catch (e) {}

console.log(`ci395(io): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
