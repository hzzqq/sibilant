// ci107 Sibilant 函数组合 comp —— 行为测试
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };
const eq = (n, expr, want) => {
  let r; try { r = run(expr); } catch(e){ fail++; console.log('  FAIL', n, '->', e.message); return; }
  const got = lispStr(r);
  ok(n + '  => ' + got, JSON.stringify(got) === JSON.stringify(want));
};

// 恒等：零参 comp 返回恒等函数
eq('(comp) 恒等', '((comp) 5)', '5');
// 两段组合：x -> (* (+ x 1) 2)，入参 3 => 8
eq('comp 两段', '((comp (lambda (x) (* x 2)) (lambda (x) (+ x 1))) 3)', '8');
// 三段组合：(- x 1) -> (* 2) -> (+ 10)，入参 5 => 18
eq('comp 三段', '((comp (lambda (x) (+ x 10)) (lambda (x) (* x 2)) (lambda (x) (- x 1))) 5)', '18');
// 绑定后调用
eq('comp 绑定为函数', '(define f (comp (lambda (x) (* x x)) (lambda (x) (+ x 1)))) (f 4)', '25');
// 与内置组合：car/cdr
eq('comp 内置 car/cdr', '((comp cdr car) (list (list 1 2) 3))', '(2)');
// list 收尾
eq('comp list 收尾', '((comp list (lambda (x) (* x 2))) 3)', '(6)');
// 用于 map
eq('comp 用于 map', '(map (comp (lambda (x) (* x x)) (lambda (x) (+ x 1))) (list 1 2 3))', '(4 9 16)');
// 文档登记
ok('doc comp 含「函数组合」', run('(doc (quote comp))').indexOf('函数组合') >= 0);
ok('help comp 可查', typeof run('(help (quote comp))') === 'string' && run('(help (quote comp))').length > 0);

console.log(`\nci107 comp: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
