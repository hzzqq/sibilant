// ci239 — Sibilant 符号 introspection：name / namespace
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL:', n); } };

// name：符号返回名称
ok('name (quote foo) => "foo"', run('(name (quote foo))') === 'foo');
ok('name (quote a/b) => "a/b"', run('(name (quote a/b))') === 'a/b');
ok('name 字符串 => 原样', run('(name "bar")') === 'bar');
ok('name 数字 => null', run('(name 5)') === null);
ok('name 列表 => null', run('(name (list 1 2))') === null);

// namespace：按 / 分割
ok('namespace (quote a/b) => "a"', run('(namespace (quote a/b))') === 'a');
ok('namespace (quote foo) => ""', run('(namespace (quote foo))') === '');
ok('namespace 字符串 => ""', run('(namespace "x")') === '');

// ---- 接线检查 ----
const src = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
ok("interpreter.js 定义 name", /def\('name'/.test(src));
ok("interpreter.js 定义 namespace", /def\('namespace'/.test(src));

console.log(`name: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
