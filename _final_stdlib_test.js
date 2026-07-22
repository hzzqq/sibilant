// ci207 — Sibilant 标准库收尾补充：ffirst / fnext / reversed / empty?(增强：覆盖 set/dict)
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };
const eq = (n, expr, want) => {
  let r; try { r = run(expr); } catch (e) { fail++; console.log('  FAIL', n, '->', e.message); return; }
  ok(n + '  => ' + lispStr(r), JSON.stringify(lispStr(r)) === JSON.stringify(want));
};
const arrEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const T = '#t', F = '#f';

// ffirst：取嵌套列表的「首首」元素
eq('ffirst (list (list 1 2) 3) => 1', '(ffirst (list (list 1 2) 3))', '1');
ok('ffirst 直接值', run('(ffirst (list (list 1 2) 3))') === 1);
ok('ffirst 三元素嵌套取首', run('(ffirst (list (list 1 2 3)))') === 1);
ok('ffirst 首元素为空表 => null', run('(ffirst (list (list) 3))') === null);
ok('ffirst 首元素非表 => null', run('(ffirst (list 5 6))') === null);
ok('ffirst 空表 => null', run('(ffirst (list))') === null);

// fnext：取嵌套列表「首元素之余部」
ok('fnext 双元素 => (2)', arrEq(run('(fnext (list (list 1 2) 3))'), [2]));
ok('fnext 单元素首 => ()', arrEq(run('(fnext (list (list 1)))'), []));
ok('fnext 三元素 => (2 3)', arrEq(run('(fnext (list (list 1 2 3)))'), [2, 3]));
ok('fnext 首非表 => ()', arrEq(run('(fnext (list 5 6))'), []));
ok('fnext 空表 => ()', arrEq(run('(fnext (list))'), []));

// reversed：返回反转后的新列表(不修改原列表)
ok('reversed (1 2 3) => (3 2 1)', arrEq(run('(reversed (list 1 2 3))'), [3, 2, 1]));
ok('reversed () => ()', arrEq(run('(reversed (list))'), []));
ok('reversed (1) => (1)', arrEq(run('(reversed (list 1))'), [1]));
ok('reversed 不改原列表', arrEq(run('(let ((x (list 1 2 3))) (reversed x) x)'), [1, 2, 3]));

// empty?：覆盖 列表/字符串/null/set/dict
eq('empty? ()', '(empty? ())', T);
eq('empty? ""', '(empty? "")', T);
eq('empty? "x"', '(empty? "x")', F);
eq('empty? (list 1)', '(empty? (list 1))', F);
eq('empty? (list)', '(empty? (list))', T);
eq('empty? (set)', '(empty? (set))', T);
eq('empty? (set 1)', '(empty? (set 1))', F);
eq('empty? (dict)', '(empty? (dict))', T);
eq('empty? (dict (quote a) 1)', '(empty? (dict (quote a) 1))', F);

// 文档登记
ok('doc ffirst 含「首首」', run('(doc (quote ffirst))').indexOf('首首') >= 0);
ok('doc reversed 含「反转」', run('(doc (quote reversed))').indexOf('反转') >= 0);
ok('doc empty? 含「空」', run('(doc (quote empty?))').indexOf('空') >= 0);

console.log(`\nci207 final_stdlib: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
