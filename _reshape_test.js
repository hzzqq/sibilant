// ci179 — Sibilant 列表整形新增一批：flatten1 / rotate-left / rotate-right / remove / keep / map-indexed / foldl1 / foldr1 / count-where / slice / take-nth
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('  FAIL', name); } }
function eq(name, src, exp){ ok(name, lispStr(run(src)) === exp); }

// ---- flatten1 ----
eq('flatten1 仅一层', '(flatten1 (quote ((1 2) (3))))', '(1 2 3)');
eq('flatten1 无嵌套', '(flatten1 (list 1 2 3))', '(1 2 3)');
eq('flatten1 空', '(flatten1 (quote ()))', '()');

// ---- rotate ----
eq('rotate-left 1', '(rotate-left 1 (list 1 2 3 4))', '(2 3 4 1)');
eq('rotate-left 2', '(rotate-left 2 (list 1 2 3 4))', '(3 4 1 2)');
eq('rotate-right 1', '(rotate-right 1 (list 1 2 3 4))', '(4 1 2 3)');
eq('rotate-left 0', '(rotate-left 0 (list 1 2 3))', '(1 2 3)');

// ---- remove ----
eq('remove even?', '(remove even? (list 1 2 3 4))', '(1 3)');
eq('remove odd?', '(remove odd? (list 1 2 3 4))', '(2 4)');

// ---- keep ----
eq('keep >2', '(keep (lambda (x) (if (> x 2) x #f)) (list 1 2 3 4))', '(3 4)');
eq('keep 全部保留', '(keep (lambda (x) x) (list 1 2 3))', '(1 2 3)');

// ---- map-indexed ----
eq('map-indexed +i', '(map-indexed (lambda (i x) (+ i x)) (list 10 10 10))', '(10 11 12)');

// ---- foldl1 / foldr1 ----
ok('foldl1 +', run('(foldl1 + (list 1 2 3 4))') === 10);
ok('foldl1 空 -> null', run('(foldl1 + (list))') === null);
eq('foldr1 嵌套', '(foldr1 (lambda (a b) (list a b)) (list 1 2 3))', '(1 (2 3))');
ok('foldr1 空 -> null', run('(foldr1 + (list))') === null);

// ---- count-where ----
ok('count-where even?', run('(count-where even? (list 1 2 3 4))') === 2);
ok('count-where 全否', run('(count-where even? (list 1 3 5))') === 0);

// ---- slice ----
eq('slice 1 3', '(slice 1 3 (list 1 2 3 4))', '(2 3)');
eq('slice 0 2', '(slice 0 2 (list 1 2 3 4))', '(1 2)');

// ---- take-nth ----
eq('take-nth 2', '(take-nth 2 (list 1 2 3 4 5))', '(1 3 5)');
eq('take-nth 1 全取', '(take-nth 1 (list 1 2 3))', '(1 2 3)');

console.log('reshape: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
