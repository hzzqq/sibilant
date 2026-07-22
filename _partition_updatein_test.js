// _partition_updatein_test.js — Sibilant partition-n / update-in 单元测试
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- partition-n ----
ok('partition-n 正常分组', lispStr(run('(partition-n 2 (list 1 2 3 4))')) === '((1 2) (3 4))');
ok('partition-n 丢弃不足尾部', lispStr(run('(partition-n 2 (list 1 2 3 4 5))')) === '((1 2) (3 4))');
ok('partition-n n=1 逐元素', lispStr(run('(partition-n 1 (list 1 2 3))')) === '((1) (2) (3))');
ok('partition-n 空列表', lispStr(run('(partition-n 2 (list))')) === '()');
ok('partition-n n=3', lispStr(run('(partition-n 3 (list (quote a) (quote b) (quote c) (quote d) (quote e) (quote f)))')) === '((a b c) (d e f))');

// ---- update-in ----
ok('update-in 嵌套 dict 更新', lispStr(run('(update-in (dict (quote a) (dict (quote b) 1)) (list (quote a) (quote b)) (lambda (v) (+ v 10)))')) === '#{a #{b 11}}');
ok('update-in 带额外参数', lispStr(run('(update-in (dict (quote x) 5) (list (quote x)) + 100)')) === '#{x 105}');
ok('update-in 向量路径', lispStr(run('(update-in (vector (vector 1 2) (vector 3 4)) (list 1 0) (lambda (v) (* v 10)))')) === '((1 2) (30 4))');
ok('update-in 缺失键建空路径', lispStr(run('(update-in (dict) (list (quote a) (quote b)) (lambda (v) (+ (or v 0) 7)))')) === '#{a #{b 7}}');
ok('update-in 不可变(原值不变)', lispStr(run('((lambda (m) (list (update-in m (list (quote a)) (lambda (v) (+ v 1))) (dict-get m (quote a)))) (dict (quote a) 1))')) === '(#{a 2} 1)');

// ---- 全局可见性（接线）----
ok('partition-n 在全局可见', typeof run('partition-n') === 'function');
ok('update-in 在全局可见', typeof run('update-in') === 'function');

console.log(`partition-n/update-in: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
