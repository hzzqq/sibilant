// ci151 Sibilant 序列工具3 —— take-while / drop-while / mapcat / split-at 行为测试
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

// take-while：取头部满足谓词者
eq('take-while 至首个负值', '(take-while pos? (list 1 2 -1 3))', '(1 2)');
eq('take-while 全满足', '(take-while even? (list 2 4 6))', '(2 4 6)');
eq('take-while 首项即不满足', '(take-while pos? (list -1 2 3))', '()');
eq('take-while 非列表', '(take-while pos? 5)', '()');

// drop-while：丢弃头部满足谓词者
eq('drop-while 至首个负值', '(drop-while pos? (list 1 2 -1 3))', '(-1 3)');
eq('drop-while 全满足', '(drop-while even? (list 2 4 6))', '()');
eq('drop-while 全不满足', '(drop-while pos? (list -1 -2 3))', '(-1 -2 3)');

// mapcat：flatMap 拼接
eq('mapcat 复制', '(mapcat (lambda (x) (list x x)) (list 1 2))', '(1 1 2 2)');
eq('mapcat 变换', '(mapcat (lambda (x) (list x (* x 10))) (list 1 2))', '(1 10 2 20)');
eq('mapcat 空', '(mapcat (lambda (x) (list x)) (list))', '()');

// split-at：按索引切两段
eq('split-at 2', '(split-at 2 (list 1 2 3 4))', '((1 2) (3 4))');
eq('split-at 0', '(split-at 0 (list 1 2 3))', '(() (1 2 3))');
eq('split-at 越界', '(split-at 9 (list 1 2 3))', '((1 2 3) ())');

// 组合：take-while + mapcat
eq('mapcat+take-while', '(take-while (lambda (x) (< x 4)) (mapcat (lambda (x) (list x (* x 2))) (list 1 2 3)))', '(1 2 2)');

// 文档登记
ok('doc take-while 含「头部」', run('(doc (quote take-while))').indexOf('头部') >= 0);
ok('doc drop-while 含「丢弃」', run('(doc (quote drop-while))').indexOf('丢弃') >= 0);
ok('doc mapcat 含「拼接」', run('(doc (quote mapcat))').indexOf('拼接') >= 0);
ok('doc split-at 含「切」', run('(doc (quote split-at))').indexOf('切') >= 0);
ok('docs 含 4 个新函数', ['take-while','drop-while','mapcat','split-at'].every(n=> run('(docs)').indexOf(n) >= 0));

console.log('lang/_seq3_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
