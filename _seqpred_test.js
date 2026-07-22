// ci223 — Sibilant 序列谓词与连接：concat / every? / not-every? / not-any?
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL:', n); } };

// concat：连接多个序列
ok('concat 两列表', lispStr(run('(concat (list 1 2) (list 3 4))')) === '(1 2 3 4)');
ok('concat 列表+单元素', lispStr(run('(concat (list 1) 2)')) === '(1 2)');
ok('concat 空参 => ()', lispStr(run('(concat)')) === '()');
ok('concat 三列表', lispStr(run('(concat (list 1) (list 2 3) (list 4))')) === '(1 2 3 4)');
ok('concat 嵌套列表保留', lispStr(run('(concat (list 1 2) (list (list 3)))')) === '(1 2 (3))');

// every?：所有元素满足谓词（if 分支用 lispStr 比较 quote 返回的 Sym）
ok('every? 全满足 => 真', lispStr(run('(if (every? even? (list 2 4 6)) (quote y) (quote n))')) === 'y');
ok('every? 有不满足 => 假', lispStr(run('(if (every? even? (list 2 3 4)) (quote y) (quote n))')) === 'n');
ok('every? 空列表恒真', lispStr(run('(if (every? even? (list)) (quote y) (quote n))')) === 'y');
ok('every? 直接返回值', run('(every? even? (list 2 4))') === true);
ok('every? 直接返回假', run('(every? even? (list 2 3))') === false);
ok('every? 用 lambda', lispStr(run('(if (every? (lambda (x) (> x 0)) (list 1 2 3)) (quote y) (quote n))')) === 'y');

// not-every?：存在不满足
ok('not-every? 有不满足 => 真', lispStr(run('(if (not-every? even? (list 2 3)) (quote y) (quote n))')) === 'y');
ok('not-every? 全满足 => 假', lispStr(run('(if (not-every? even? (list 2 4)) (quote y) (quote n))')) === 'n');
ok('not-every? 空列表 => 假', lispStr(run('(if (not-every? even? (list)) (quote y) (quote n))')) === 'n');

// not-any?：没有任何满足（not-any? 为解释器既有内置，此处验证语义）
ok('not-any? 全不满足 => 真', lispStr(run('(if (not-any? odd? (list 2 4)) (quote y) (quote n))')) === 'y');
ok('not-any? 有满足 => 假', lispStr(run('(if (not-any? even? (list 1 2)) (quote y) (quote n))')) === 'n');
ok('not-any? 空列表恒真', lispStr(run('(if (not-any? even? (list)) (quote y) (quote n))')) === 'y');
ok('not-any? 直接返回真', run('(not-any? odd? (list 2 4))') === true);

console.log(`seqpred: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
