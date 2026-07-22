// 测试 Sibilant 数值/字符串/列表补充工具 builtins。
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }
function eq(a, b){ return JSON.stringify(a) === JSON.stringify(b); }
function close(a, b, eps){ return Math.abs(a - b) < (eps || 1e-6); }

// 阶乘
ok('(factorial 5) => 120', run('(factorial 5)') === 120);
ok('(factorial 0) => 1', run('(factorial 0)') === 1);
ok('(factorial 1) => 1', run('(factorial 1)') === 1);

// 素数
ok('(is-prime 7) => #t', run('(is-prime 7)') === true);
ok('(is-prime 9) => #f', run('(is-prime 9)') === false);
ok('(is-prime 1) => #f', run('(is-prime 1)') === false);
ok('(is-prime 2) => #t', run('(is-prime 2)') === true);

// 取反
ok('(negate 5) => -5', run('(negate 5)') === -5);
ok('(negate -3) => 3', run('(negate -3)') === 3);

// 角度/弧度
ok('(to-degrees 1.5707963) ≈ 90', close(run('(to-degrees 1.5707963)'), 90, 1e-3));
ok('(to-radians 180) ≈ 3.14159', close(run('(to-radians 180)'), Math.PI, 1e-4));
ok('(to-degrees (to-radians 45)) ≈ 45', close(run('(to-degrees (to-radians 45))'), 45, 1e-6));

// 字符串
ok('(string-index-of "hello" "ll") => 2', run('(string-index-of "hello" "ll")') === 2);
ok('(string-index-of "hello" "z") => -1', run('(string-index-of "hello" "z")') === -1);
ok('(string-repeat "ab" 3) => "ababab"', run('(string-repeat "ab" 3)') === 'ababab');
ok('(string-upper "Hi") => "HI"', run('(string-upper "Hi")') === 'HI');
ok('(string-lower "Hi") => "hi"', run('(string-lower "Hi")') === 'hi');

// 列表
ok('(replicate 3 0) => (0 0 0)', eq(run('(replicate 3 0)'), [0,0,0]));
ok('(cycle 5 (list 1 2)) => (1 2 1 2 1)', eq(run('(cycle 5 (list 1 2))'), [1,2,1,2,1]));
ok('(pad 5 0 (list 1 2)) => (1 2 0 0 0)', eq(run('(pad 5 0 (list 1 2))'), [1,2,0,0,0]));
ok('(pad 2 0 (list 1 2 3)) 已够长原样', eq(run('(pad 2 0 (list 1 2 3))'), [1,2,3]));

console.log(`mathstr: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
