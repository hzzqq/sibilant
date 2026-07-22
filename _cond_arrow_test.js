// _cond_arrow_test.js — Sibilant cond-> (ci303) 单元测试 + 隐性问题(reduce 缺失文档)验证
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- cond-> (特殊形式，条件线程) ----
ok('cond-> 条件成立应用', run('(cond-> 0 (#t (+ 1)) (#f (* 2)))') === 1);
ok('cond-> 多条件选择性应用', run('(cond-> 10 ((< 0 1) (+ 5)) ((> 0 1) (* 2)))') === 15);
ok('cond-> 全假不变', run('(cond-> 7 (#f (+ 1)) (#f (+ 2)))') === 7);
ok('cond-> 串接', run('(cond-> 1 (#t (* 2)) (#t (+ 10)))') === 12);

// ---- R2 隐性问题：reduce 长期缺失自省文档，现已补全（可观测性） ----
ok('reduce 文档可见(隐性补全)', run('(doc reduce)') !== '无文档');
ok('reduce 功能正常', run('(reduce + 0 (list 1 2 3))') === 6);

console.log(`cond->: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
