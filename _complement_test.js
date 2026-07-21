// ci131 Sibilant 高阶谓词 complement —— 行为测试
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };
const eq = (n, expr, want) => {
  let r; try { r = run(expr); } catch(e){ fail++; console.log('  FAIL', n, '->', e.message); return; }
  ok(n + '  => ' + lispStr(r), JSON.stringify(lispStr(r)) === JSON.stringify(want));
};

// filter + complement：筛出不满足谓词的成员
eq('filter (complement even?)', '(filter (complement even?) (list 1 2 3))', '(1 3)');
eq('filter (complement odd?)', '(filter (complement odd?) (list 1 2 3 4))', '(2 4)');
eq('自定义谓词 pos?', '(define pos? (lambda (x) (> x 0))) (filter (complement pos?) (list -1 0 2 3))', '(-1 0)');
eq('complement 实现 remove(>2)', '(filter (complement (lambda (x) (> x 2))) (list 1 2 3 4))', '(1 2)');

// 在 if 中的真值语义（Sibilant: false/null 为假，其余为真）
eq('complement 当 pred 假 → if 真', '(if ((complement even?) 3) (quote yes) (quote no))', 'yes');
eq('complement 当 pred 真 → if 假', '(if ((complement even?) 2) (quote yes) (quote no))', 'no');

// 直接返回布尔（#t/#f）
ok('((complement even?) 3) 返回 #t', run('((complement even?) 3)') === true);
ok('((complement even?) 2) 返回 #f', run('((complement even?) 2)') === false);

// 高阶组合：complement 的 complement 应等价于原谓词
eq('complement 的 complement = 自身', '(filter (complement (complement even?)) (list 1 2 3 4))', '(2 4)');

// 文档登记
ok('doc complement 含「否定」', run('(doc (quote complement))').indexOf('否定') >= 0);
ok('docs 列表含 complement', run('(docs)').indexOf('complement') >= 0);

console.log(`\nci131 complement: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
