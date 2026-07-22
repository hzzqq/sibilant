// _declare_test.js — Sibilant declare (ci319) 单元测试 + 隐性问题(map/filter 缺失文档)验证
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- declare (特殊形式，前向声明) ----
ok('declare 后定义并调用', run('(begin (declare h) (define h (lambda (n) (if (= n 0) 1 (* n (h (- n 1))))) ) (h 4))') === 24);
ok('declare 支持互递归', run('(begin (declare even?2) (declare odd?2) (define even?2 (lambda (n) (if (= n 0) #t (odd?2 (- n 1))))) (define odd?2 (lambda (n) (if (= n 0) #f (even?2 (- n 1))))) (even?2 4))') === true);
ok('declare 使符号存在', run('(begin (declare zz) (if (eq? zz zz) 1 2))') === 1);

// ---- R2 隐性问题：map/filter 长期缺失自省文档，现已补全 ----
ok('map 文档可见(隐性补全)', run('(doc map)') !== '无文档');
ok('filter 文档可见(隐性补全)', run('(doc filter)') !== '无文档');
ok('map 功能正常', lispStr(run('(map inc (list 1 2))')) === '(2 3)');

console.log(`declare: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
