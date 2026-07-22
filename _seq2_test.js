// ci147 Sibilant 序列工具 —— reductions / interpose / iterate / some 行为测试
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c)=> { if(c) pass++; else { fail++; console.log('  FAIL:', n); } };
const eq = (n, expr, want)=> {
  let r; try { r = run(expr); } catch(e){ fail++; console.log('  FAIL', n, '->', e.message); return; }
  ok(n + '  => ' + lispStr(r), JSON.stringify(lispStr(r)) === JSON.stringify(want));
};

// reductions：前缀归约(scanl)
eq('reductions + 0', '(reductions + 0 (list 1 2 3))', '(0 1 3 6)');
eq('reductions * 1', '(reductions * 1 (list 2 3 4))', '(1 2 6 24)');
eq('reductions 空列表', '(reductions + 0 (list))', '(0)');
eq('reductions 非列表', '(reductions + 0 5)', '()');

// interpose：插入分隔
eq('interpose 0', '(interpose 0 (list 1 2 3))', '(1 0 2 0 3)');
eq('interpose 单元素', '(interpose 0 (list 9))', '(9)');
eq('interpose 空', '(interpose 0 (list))', '()');

// iterate：生成 n 项
eq('iterate 双乘 4 项', '(iterate (lambda (v) (* v 2)) 1 4)', '(1 2 4 8)');
eq('iterate 加 1 5 项', '(iterate (lambda (v) (+ v 1)) 0 5)', '(0 1 2 3 4)');
eq('iterate 0 项', '(iterate (lambda (v) (* v 2)) 1 0)', '()');

// some：首个真值
eq('some 首个偶数', '(some even? (list 1 3 4))', '4');
eq('some 无真值', '(some odd? (list 2 4))', '#f');
eq('some 返回真值本身(非仅真)', '(some (lambda (x) (if (> x 2) x #f)) (list 1 2 3 4))', '3');
eq('some 非列表', '(some even? 5)', '#f');

// 组合：iterate + reductions 生成斐波那契
eq('iterate+reductions 斐波那契前缀和', '(reductions + 0 (iterate (lambda (v) (* v 2)) 1 4))', '(0 1 3 7 15)');

// 文档登记
ok('doc reductions 含「前缀归约」', run('(doc (quote reductions))').indexOf('前缀归约') >= 0);
ok('doc interpose 含「插入」', run('(doc (quote interpose))').indexOf('插入') >= 0);
ok('doc iterate 含「迭代」', run('(doc (quote iterate))').indexOf('迭代') >= 0);
ok('doc some 含「首个」', run('(doc (quote some))').indexOf('首个') >= 0);
ok('docs 含 4 个新函数', ['reductions','interpose','iterate','some'].every(n=> run('(docs)').indexOf(n) >= 0));

console.log('lang/_seq2_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
