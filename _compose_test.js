// ci143 Sibilant 字典组合 + 序列排序/分块工具 —— merge / update / get-in / sort-by / partition 行为测试
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

// ---- merge：字典合并(后者覆盖前者) ----
eq('merge 两字典', '(merge (dict (quote a) 1) (dict (quote b) 2))', '#{a 1 b 2}');
eq('merge 冲突后者胜', '(merge (dict (quote a) 1) (dict (quote a) 2))', '#{a 2}');
eq('merge 嵌套值', '(merge (dict (quote a) 1) (dict (quote b) (list 1 2)))', '#{a 1 b (1 2)}');
eq('merge 空 + 字典', '(merge (dict) (dict (quote a) 1))', '#{a 1}');

// ---- update：以函数更新键 ----
eq('update 加 10', '(update (dict (quote x) 1) (quote x) (lambda (v) (+ v 10)))', '#{x 11}');
eq('update 缺失键以 null 起算', '(update (dict) (quote n) (lambda (v) (if (nil? v) 0 (+ v 1))))', '#{n 0}');

// ---- get-in：嵌套取值 ----
eq('get-in 双层 dict', '(get-in (dict (quote a) (dict (quote b) 2)) (list (quote a) (quote b)))', '2');
eq('get-in 数组下标', '(get-in (list (list 1 2) (list 3 4)) (list 1 0))', '3');
eq('get-in 缺失默认 ()', '(get-in (dict (quote a) 1) (list (quote z)))', '()');
eq('get-in 缺失带默认值', '(get-in (dict (quote a) 1) (list (quote z)) 99)', '99');

// ---- sort-by：按键函数排序 ----
eq('sort-by mod3', '(sort-by (lambda (x) (mod x 3)) (list 3 1 2))', '(3 1 2)');
eq('sort-by 负值', '(sort-by - (list 3 1 2))', '(3 2 1)');
eq('sort-by 空', '(sort-by - (list))', '()');

// ---- partition：定长分块 ----
eq('partition 2', '(partition 2 (list 1 2 3 4 5))', '((1 2) (3 4) (5))');
eq('partition 3', '(partition 3 (list 1 2 3 4))', '((1 2 3) (4))');
eq('partition 空', '(partition 2 (list))', '()');

// ---- 组合：merge 后 get-in 取嵌套 ----
eq('merge + get-in', '(get-in (merge (dict (quote u) (dict (quote name) (quote neo))) (dict (quote v) 9)) (list (quote u) (quote name)))', 'neo');

// ---- 文档登记 ----
ok('doc merge 含「合并」', run('(doc (quote merge))').indexOf('合并') >= 0);
ok('doc sort-by 含「排序」', run('(doc (quote sort-by))').indexOf('排序') >= 0);
ok('doc get-in 含「嵌套」', run('(doc (quote get-in))').indexOf('嵌套') >= 0);
ok('docs 含 merge/sort-by/partition/get-in/update', ['merge','sort-by','partition','get-in','update'].every(n=> run('(docs)').indexOf(n) >= 0));

// ---- 错误路径 ----
let threw = false;
try { run('(merge 1 2)'); } catch(e){ threw = true; }
ok('merge 非 dict 抛错', threw);

console.log('lang/_compose_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
