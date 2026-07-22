// _defonce_test.js — Sibilant defonce (ci315) 单元测试 + 隐性问题(foldl/foldr 缺失文档)验证
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- defonce (特殊形式，幂等定义) ----
ok('defonce 首次定义生效', run('(begin (defonce dx 5) dx)') === 5);
ok('defonce 已定义跳过', run('(begin (defonce dx 5) (defonce dx 99) dx)') === 5);
ok('defonce 不同名正常', run('(begin (defonce dy 7) dy)') === 7);

// ---- R2 隐性问题：foldl/foldr 长期缺失自省文档，现已补全 ----
ok('foldl 文档可见(隐性补全)', run('(doc foldl)') !== '无文档');
ok('foldr 文档可见(隐性补全)', run('(doc foldr)') !== '无文档');
ok('foldl 功能正常', run('(foldl + 0 (list 1 2 3))') === 6);

console.log(`defonce: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
