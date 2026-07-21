// ci139 Sibilant 序列分组/切分工具 —— group-by / partition-by / split-with / interleave 行为测试
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

// group-by：按分组键聚合为 dict(保持插入序)
eq('group-by even?', '(group-by even? (list 1 2 3 4))', '#{#f (1 3) #t (2 4)}');
eq('group-by 自定义键', '(group-by (lambda (x) (mod x 3)) (list 1 2 3 4 5 6))', '#{1 (1 4) 2 (2 5) 0 (3 6)}');
eq('group-by 空', '(group-by even? (list))', '#{}');

// partition-by：相邻同键值切段
eq('partition-by even?', '(partition-by even? (list 1 2 4 3 5))', '((1) (2 4) (3 5))');
eq('partition-by 全同组', '(partition-by (lambda (x) 1) (list 1 2 3))', '((1 2 3))');
eq('partition-by 空', '(partition-by even? (list))', '()');

// split-with：首个不满足处分切
eq('split-with pos?', '(split-with pos? (list 1 2 -1 3))', '((1 2) (-1 3))');
eq('split-with 全不满足', '(split-with (lambda (x) (> x 10)) (list 1 2))', '(() (1 2))');
eq('split-with 全满足', '(split-with pos? (list 1 2 3))', '((1 2 3) ())');

// interleave：多列表交错合并
eq('interleave 两列', '(interleave (list 1 2) (list 3 4 5))', '(1 3 2 4 5)');
eq('interleave 三列', '(interleave (list 1) (list 2) (list 3))', '(1 2 3)');
eq('interleave 空列', '(interleave (list))', '()');

// 组合：先 group-by 再取某组(用 dict-get)
eq('group-by + dict-get', '(dict-get (group-by even? (list 1 2 3 4)) #t)', '(2 4)');

// 文档登记
ok('doc group-by 含「分组」', run('(doc (quote group-by))').indexOf('分组') >= 0);
ok('docs 含 group-by', run('(docs)').indexOf('group-by') >= 0);
ok('docs 含 partition-by', run('(docs)').indexOf('partition-by') >= 0);
ok('docs 含 split-with', run('(docs)').indexOf('split-with') >= 0);
ok('docs 含 interleave', run('(docs)').indexOf('interleave') >= 0);

console.log(`\nci139 seq: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
