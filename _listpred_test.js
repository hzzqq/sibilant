// 测试 Sibilant 列表/谓词 补充工具 builtins。
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }
function eq(a, b){ return JSON.stringify(a) === JSON.stringify(b); }

// 访问器
ok('(fourth (list 1 2 3 4)) => 4', run('(fourth (list 1 2 3 4))') === 4);
ok('(fourth (list 1 2)) => ()', run('(fourth (list 1 2))') === null);

// identity / constantly
ok('(identity 5) => 5', run('(identity 5)') === 5);
ok('(map identity (list 1 2)) => (1 2)', eq(run('(map identity (list 1 2))'), [1,2]));
ok('(map (constantly 0) (list 1 2 3)) => (0 0 0)', eq(run('(map (constantly 0) (list 1 2 3))'), [0,0,0]));

// some? / not-any?
ok('(some? even? (list 1 3 4)) => #t', run('(some? even? (list 1 3 4))') === true);
ok('(some? even? (list 1 3 5)) => #f', run('(some? even? (list 1 3 5))') === false);
ok('(not-any? even? (list 1 3 5)) => #t', run('(not-any? even? (list 1 3 5))') === true);
ok('(not-any? even? (list 1 3 4)) => #f', run('(not-any? even? (list 1 3 4))') === false);

// dedupe (相邻去重)
ok('(dedupe (list 1 1 2 2 1)) => (1 2 1)', eq(run('(dedupe (list 1 1 2 2 1))'), [1,2,1]));
ok('(dedupe (list 1 2 3)) => (1 2 3)', eq(run('(dedupe (list 1 2 3))'), [1,2,3]));
ok('(dedupe (list 5 5 5)) => (5)', eq(run('(dedupe (list 5 5 5))'), [5]));

// intersperse
ok('(intersperse 0 (list 1 2 3)) => (1 0 2 0 3)', eq(run('(intersperse 0 (list 1 2 3))'), [1,0,2,0,3]));
ok('(intersperse "x" (list "a")) => ("a")', eq(run('(intersperse "x" (list "a"))'), ['a']));
ok('(intersperse 9 (list)) => ()', eq(run('(intersperse 9 (list))'), []));

// max-by / min-by
ok('(max-by (lambda (x) (first x)) (list (list 1 "a") (list 3 "b") (list 2 "c"))) => (3 "b")', eq(run('(max-by (lambda (x) (first x)) (list (list 1 "a") (list 3 "b") (list 2 "c")))'), [3,'b']));
ok('(min-by (lambda (x) (first x)) (list (list 1 "a") (list 3 "b") (list 2 "c"))) => (1 "a")', eq(run('(min-by (lambda (x) (first x)) (list (list 1 "a") (list 3 "b") (list 2 "c")))'), [1,'a']));
ok('(max-by (lambda (x) x) (list -3 7 -1)) => 7', run('(max-by (lambda (x) x) (list -3 7 -1))') === 7);

console.log(`listpred: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
