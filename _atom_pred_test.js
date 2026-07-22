// _atom_pred_test.js — Sibilant atom? (ci323) 单元测试 + 隐性问题(for-each 缺失文档)验证
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- atom? (谓词) ----
ok('atom? atom 为真', run('(atom? (atom 0))') === true);
ok('atom? 数字为假', run('(atom? 5)') === false);
ok('atom? 列表为假', run('(atom? (list 1))') === false);
ok('atom? 字符串为假', run('(atom? "x")') === false);
ok('atom? 在全局可见', typeof run('atom?') === 'function');

// ---- R2 隐性问题：for-each 长期缺失自省文档，现已补全 ----
ok('for-each 文档可见(隐性补全)', run('(doc for-each)') !== '无文档');
ok('for-each 副作用', run('(let ((a (atom 0))) (for-each (lambda (x) (swap! a + x)) (list 1 2 3)) (deref a))') === 6);

console.log(`atom?: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
