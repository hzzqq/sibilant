// ci331 测试：列表进阶 helper (rotations / chunk-by / flatten-deep / tally / unzip / scanl)
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function eq(expr, expected, note){
  let got;
  try { got = lispStr(run(expr)); }
  catch(e){ got = 'ERROR: ' + e.message; }
  if(got === expected){ pass++; console.log(`  ok  ${note || expr} => ${got}`); }
  else { fail++; console.log(`FAIL  ${note || expr}\n      期望 ${expected}\n      实际 ${got}`); }
}

console.log('== rotations ==');
eq('(rotations (list 1 2 3))', '((1 2 3) (2 3 1) (3 1 2))');
eq('(rotations (list 7))', '((7))');
eq('(rotations (list))', '(())', '空列表 => 单个空旋转');
eq('(length (rotations (list 1 2 3 4 5)))', '5');

console.log('== chunk-by ==');
eq('(chunk-by (lambda (x) (< x 3)) (list 1 2 5 6 2))', '((1 2) (5 6) (2))');
eq('(chunk-by (lambda (x) (mod x 2)) (list 1 3 2 4 6 7))', '((1 3) (2 4 6) (7))');
eq('(chunk-by (lambda (x) x) (list))', '()', '空列表 => 空');
eq('(chunk-by (lambda (x) 1) (list 1 2 3))', '((1 2 3))', '全同键 => 一块');

console.log('== flatten-deep ==');
eq('(flatten-deep (list 1 (list 2 (list 3 4)) 5))', '(1 2 3 4 5)');
eq('(flatten-deep (list (list (list (list 9)))))', '(9)');
eq('(flatten-deep (list))', '()');
eq('(flatten-deep (list 1 2 3))', '(1 2 3)', '已平坦不变');

console.log('== tally ==');
eq('(dict-get (tally (list "a" "b" "a")) "a")', '2');
eq('(dict-get (tally (list "a" "b" "a")) "b")', '1');
eq('(dict-get (tally (list 1 2 1 1)) 1)', '3');
eq('(length (keys (tally (list "x" "y" "x"))))', '2', '不同键数量');

console.log('== unzip ==');
eq('(unzip (list (list 1 "a") (list 2 "b")))', '((1 2) ("a" "b"))');
eq('(unzip (list))', '(() ())');
eq('(first (unzip (list (list 1 10) (list 2 20) (list 3 30))))', '(1 2 3)');

console.log('== scanl ==');
eq('(scanl + 0 (list 1 2 3))', '(0 1 3 6)');
eq('(scanl * 1 (list 2 3 4))', '(1 2 6 24)');
eq('(scanl + 100 (list))', '(100)', '空列表 => 只含初值');

console.log('== 与既有函数组合 ==');
eq('(flatten-deep (rotations (list 1 2)))', '(1 2 2 1)');
eq('(scanl + 0 (flatten-deep (list (list 1) (list 2 3))))', '(0 1 3 6)');

console.log(`\nci331: ${pass} 通过, ${fail} 失败`);
if(fail > 0) process.exit(1);
console.log('ALL PASS');
