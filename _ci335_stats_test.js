// ci335 测试：统计/取整 helper (stddev / percentile / argmax / argmin / round-to)
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
function approx(expr, expected, eps, note){
  let v;
  try { v = run(expr); }
  catch(e){ fail++; console.log(`FAIL  ${note || expr} 抛错 ${e.message}`); return; }
  if(typeof v === 'number' && Math.abs(v - expected) <= (eps || 1e-3)){ pass++; console.log(`  ok  ${note || expr} ≈ ${expected}`); }
  else { fail++; console.log(`FAIL  ${note || expr}\n      期望 ≈${expected}\n      实际 ${v}`); }
}

console.log('== stddev ==');
approx('(stddev (list 2 4 4 4 5 5 7 9))', 2.138, 0.001);
eq('(stddev (list 5))', '0', '单元素 => 0');
eq('(stddev (list))', '0', '空列表 => 0');
eq('(stddev (list 3 3 3 3))', '0', '常数列 => 0');

console.log('== percentile ==');
eq('(percentile (list 1 2 3 4) 50)', '2.5');
eq('(percentile (list 1 2 3 4) 0)', '1');
eq('(percentile (list 1 2 3 4) 100)', '4');
approx('(percentile (list 1 2 3 4) 25)', 1.75, 1e-9);
eq('(percentile (list 3 1 2) 50)', '2', '自动排序');
eq('(percentile (list) 50)', '0', '空列表 => 0');
eq('(percentile (list 1 2) 200)', '2', 'p 超界钳制到 100');

console.log('== argmax / argmin ==');
eq('(argmax (lambda (x) (* x x)) (list -3 2 1))', '-3');
eq('(argmin (lambda (x) (abs x)) (list -3 2 1))', '1');
eq('(argmax (lambda (x) x) (list 5 9 2))', '9');
eq('(argmin (lambda (x) x) (list 5 9 2))', '2');
eq('(argmax (lambda (x) 1) (list "a" "b"))', '"a"', '并列取最先');
eq('(argmax (lambda (x) x) (list))', '()', '空列表 => null');
eq('(argmax (lambda (p) (second p)) (list (list "a" 3) (list "b" 7) (list "c" 5)))', '("b" 7)', '按第二列取最大对');

console.log('== round-to ==');
eq('(round-to 7 5)', '5');
eq('(round-to 8 5)', '10');
eq('(round-to 3.14159 0.01)', '3.14');
eq('(round-to -7 5)', '-5');
eq('(round-to 12 0)', '12', 'step=0 按 1 处理');
eq('(round-to 2.5 1)', '3', '半值向上(Math.round)');

console.log('== 组合 ==');
eq('(round-to (percentile (list 1 2 3 4) 50) 1)', '3', '组合：中位取整');
approx('(stddev (scanl + 0 (list 1 2 3)))', 2.6458, 0.001, '组合：scanl 后求 stddev');

console.log(`\nci335: ${pass} 通过, ${fail} 失败`);
if(fail > 0) process.exit(1);
console.log('ALL PASS');
