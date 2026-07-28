// ci433 — Sibilant 字符串前缀/后缀判定（新增）+ 重复定义清理
// R1：新增 starts-with? / ends-with?（此前缺失）
// R2(隐性清理)：1) 移除 ci417 重复定义的 every?(无文档副本遮蔽带文档 canonical)，为 any? 补文档；
//             2) ci433 初版误加了与既有签名冲突的 string-join 重复副本((sep,coll) 反序)，已删除副本恢复 canonical (l sep)，
//                并用本测试验证 string-join 签名恢复正确。
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

// 1) starts-with? / ends-with?（ci433 真正新增）
ok('starts-with? 命中', run('(starts-with? "hello" "he")') === true);
ok('starts-with? 未命中', run('(starts-with? "hello" "lo")') === false);
ok('ends-with? 命中', run('(ends-with? "hello" "lo")') === true);
ok('ends-with? 未命中', run('(ends-with? "hello" "he")') === false);

// 2) R2 回归验证：string-join 副本已删除，恢复 canonical 签名 (l sep)
ok('string-join canonical (l sep)', run('(string-join (list "a" "b" "c") ", ")') === 'a, b, c');
ok('substring canonical (s i j)', run('(substring "hello" 1 3)') === 'el');

// 3) R2：every? 在移除重复定义后仍正确且带文档；any? 已补文档
ok('every? 仍可用', run('(every? even? (list 2 4 6))') === true);
ok('every? 有文档(doc 返回非空)', (()=>{ const d = run('(doc "every?")'); return typeof d === 'string' && d.length > 0; })());
ok('any? 有文档(doc 返回非空)', (()=>{ const d = run('(doc "any?")'); return typeof d === 'string' && d.length > 0; })());

console.log(`\nci433 string prefix/suffix + cleanup: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
