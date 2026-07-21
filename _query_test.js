// ci135 Sibilant 列表查询工具 —— find / find-index / distinct / frequencies 行为测试
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

// find：返回首个满足谓词的元素
eq('find even?', '(find even? (list 1 3 4 6))', '4');
eq('find 未命中返回 null', '(find even? (list 1 3 5))', '()');
eq('find 自定义谓词', '(find (lambda (x) (> x 3)) (list 1 2 3 4 5))', '4');

// find-index：返回首个满足谓词的下标
eq('find-index even?', '(find-index even? (list 1 3 4 6))', '2');
eq('find-index 未命中返回 null', '(find-index even? (list 1 3 5))', '()');

// distinct：去重并保序
eq('distinct 基本', '(distinct (list 1 1 2 3 2))', '(1 2 3)');
eq('distinct 嵌套 deepEqual', '(distinct (list (list 1) (list 1) (list 2)))', '((1) (2))');
eq('distinct 空', '(distinct (list))', '()');

// frequencies：返回计数 dict #{元素 次数 ...}（Dict 字面量，插入序）
eq('frequencies 基本', '(frequencies (list 1 1 2))', '#{1 2 2 1}');
eq('frequencies 混合', '(frequencies (list 1 2 2 3 3 3))', '#{1 1 2 2 3 3}');
eq('frequencies 嵌套键', '(frequencies (list (list 1) (list 1) (list 2)))', '#{(1) 2 (2) 1}');

// 组合：distinct 后再 frequencies（去重后每项计数 1）
eq('distinct 后再 frequencies', '(frequencies (distinct (list 1 1 2 2 2)))', '#{1 1 2 1}');

// 文档登记
ok('doc find 含「首个」', run('(doc (quote find))').indexOf('首个') >= 0);
ok('docs 列表含 find', run('(docs)').indexOf('find') >= 0);
ok('docs 列表含 frequencies', run('(docs)').indexOf('frequencies') >= 0);

console.log(`\nci135 query: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
