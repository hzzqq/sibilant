// ci167 — Sibilant 字符串工具补全 + 列表组合/矩阵：string-starts-with? / string-ends-with? / string-pad-start / string-pad-end / char-at / transpose / zip-with / cartesian-product
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();

const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('  FAIL', name); } }
function runOrErr(src){ try { return { v: run(src), err: null }; } catch(e){ return { v: null, err: e }; } }

// ---- 字符串前缀/后缀 ----
ok('starts-with? hello/he', run('(string-starts-with? "hello" "he")') === true);
ok('starts-with? hello/x 否', run('(string-starts-with? "hello" "x")') === false);
ok('ends-with? hello/lo', run('(string-ends-with? "hello" "lo")') === true);
ok('ends-with? hello/x 否', run('(string-ends-with? "hello" "x")') === false);

// ---- 补齐 ----
ok('pad-start 7 3 0', run('(string-pad-start "7" 3 "0")') === '007');
ok('pad-start 短于 n 不截断', run('(string-pad-start "abcd" 3 "0")') === 'abcd');
ok('pad-start 默认空格', run('(string-pad-start "ab" 4)') === '  ab');
ok('pad-end 7 3 0', run('(string-pad-end "7" 3 "0")') === '700');
ok('pad-end 默认空格', run('(string-pad-end "ab" 4)') === 'ab  ');

// ---- char-at ----
ok('char-at abc 1', run('(char-at "abc" 1)') === 'b');
ok('char-at abc 0', run('(char-at "abc" 0)') === 'a');
ok('char-at 越界 null', run('(char-at "abc" 9)') === null);

// ---- transpose ----
ok('transpose 2x2', lispStr(run('(transpose (list (list 1 2) (list 3 4)))')) === '((1 3) (2 4))');
ok('transpose 3x2', lispStr(run('(transpose (list (list 1 2 3) (list 4 5 6)))')) === '((1 4) (2 5) (3 6))');
ok('transpose 不等长补 null', lispStr(run('(transpose (list (list 1 2) (list 3)))')) === '((1 3) (2 ()))');
ok('transpose 空', lispStr(run('(transpose (list))')) === '()');

// ---- zip-with ----
ok('zip-with +', lispStr(run('(zip-with + (list 1 2) (list 10 20))')) === '(11 22)');
ok('zip-with 取较短', lispStr(run('(zip-with * (list 1 2 3) (list 10 20))')) === '(10 40)');
ok('zip-with 字符串拼接', lispStr(run('(zip-with string-append (list "a" "b") (list "x" "y"))')) === '("ax" "by")');

// ---- cartesian-product ----
ok('笛卡尔积 2x2', lispStr(run('(cartesian-product (list 1 2) (list 3 4))')) === '((1 3) (1 4) (2 3) (2 4))');
ok('笛卡尔积 3 列表', run('(length (cartesian-product (list 1 2) (list 3 4) (list 5 6)))') === 8);
ok('笛卡尔积 单列表', lispStr(run('(cartesian-product (list 1 2 3))')) === '((1) (2) (3))');

// ---- 错误分支 ----
ok('string-starts-with? 非字符串不崩', runOrErr('(string-starts-with? 123 "1")').err === null);

// ---- 接线：doc 注册 ----
ok('doc string-starts-with?', run('(doc "string-starts-with?")') !== null);
ok('doc transpose', run('(doc "transpose")') !== null);
ok('doc zip-with', run('(doc "zip-with")') !== null);
ok('doc cartesian-product', run('(doc "cartesian-product")') !== null);

console.log(`lang/_combinators_test.js  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
