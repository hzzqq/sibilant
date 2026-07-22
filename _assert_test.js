// _assert_test.js — Sibilant assert (ci311) 单元测试 + 隐性问题(flatten 缺失文档)验证
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- assert (特殊形式) ----
ok('assert 真返回#t', run('(assert (< 1 2))') === true);
ok('assert 假抛错', (function(){ try { run('(assert (= 1 2) "不相等")'); return false; } catch(e){ return true; } })());
ok('assert 带消息', (function(){ try { run('(assert #f "出错了")'); return false; } catch(e){ return /出错了/.test(e.message); } })());

// ---- R2 隐性问题：flatten 长期缺失自省文档，现已补全 ----
ok('flatten 文档可见(隐性补全)', run('(doc flatten)') !== '无文档');
ok('flatten 功能正常', lispStr(run('(flatten (quote (1 (2 (3)))))')) === '(1 2 3)');

console.log(`assert: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
