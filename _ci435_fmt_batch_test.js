// ci435 — Sibilant 字符串/序列工具补充批 + 重复定义清理
// R1：新增 fmt / split-lines / drop-nth / char-upcase / char-downcase（此前均缺失）
// R2(隐性清理)：移除既有重复定义 repeat(ci417 副本, 后段已有 canonical) 与 doc(ci 前段副本, 后段已有 canonical)，
//     消除重复定义遮蔽隐患（与 ci433 清理 every?/本次清理 string-join 同一类问题）。
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
global.require = require;
new Function(code)();
const S = global.window.Sibilant;
if (!S || typeof S.run !== 'function') { console.error('FAIL: runtime'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }
const run = (s)=> S.run(s);

// 1) char-upcase / char-downcase
ok('char-upcase', run('(char-upcase "a")') === 'A');
ok('char-upcase 非单字符原样', run('(char-upcase "ab")') === 'ab');
ok('char-downcase', run('(char-downcase "Z")') === 'z');

// 2) split-lines
ok('split-lines \\n', JSON.stringify(run('(split-lines "a\nb")')) === '["a","b"]');
ok('split-lines \\r\\n', JSON.stringify(run('(split-lines "a\r\nb")')) === '["a","b"]');

// 3) fmt
ok('fmt %s %d', run('(fmt "hi %s=%d" "x" 3)') === 'hi x=3');
ok('fmt %% 转义', run('(fmt "100%%")') === '100%');
ok('fmt %x', run('(fmt "%x" 255)') === 'ff');
ok('fmt %f', run('(fmt "%f" 3)') === '3');

// 4) drop-nth
ok('drop-nth 2', JSON.stringify(run('(drop-nth 2 (list 1 2 3 4))')) === '[1,3]');
ok('drop-nth 3', JSON.stringify(run('(drop-nth 3 (list 1 2 3 4 5 6))')) === '[1,2,4,5]');

// 5) R2：重复定义移除后 canonical 仍正常（repeat / doc）
ok('repeat 仍可用(移除重复副本后)', JSON.stringify(run('(repeat 7 3)')) === '[7,7,7]');
ok('doc 仍可用(移除重复副本后)', (()=>{ const d = run('(doc "range")'); return typeof d === 'string' && d.length > 0; })());

console.log(`\nci435 fmt+seq batch: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
