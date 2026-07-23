// _ci327_numstr_test.js — Sibilant ci327 数字/字符串 helper 单元测试
// sign / digits / from-digits / digit-sum / palindrome? / string-pad-left / string-pad-right
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- sign ----
ok('sign 正数', run('(sign 5)') === 1);
ok('sign 负数', run('(sign -3.2)') === -1);
ok('sign 零', run('(sign 0)') === 0);

// ---- digits ----
ok('digits 123', lispStr(run('(digits 123)')) === '(1 2 3)');
ok('digits 负数忽略符号', lispStr(run('(digits -45)')) === '(4 5)');
ok('digits 0', lispStr(run('(digits 0)')) === '(0)');
ok('digits 截断小数', lispStr(run('(digits 12.9)')) === '(1 2)');

// ---- from-digits ----
ok('from-digits 基本', run('(from-digits (list 1 2 3))') === 123);
ok('from-digits 空列表=0', run('(from-digits (list))') === 0);
ok('from-digits 单元素', run('(from-digits (list 7))') === 7);
ok('digits/from-digits 往返', run('(from-digits (digits 90210))') === 90210);

// ---- digit-sum ----
ok('digit-sum 123=6', run('(digit-sum 123)') === 6);
ok('digit-sum 负数', run('(digit-sum -99)') === 18);
ok('digit-sum 0', run('(digit-sum 0)') === 0);

// ---- palindrome? ----
ok('palindrome? 字符串真', run('(palindrome? "level")') === true);
ok('palindrome? 字符串假', run('(palindrome? "abc")') === false);
ok('palindrome? 列表真', run('(palindrome? (list 1 2 1))') === true);
ok('palindrome? 列表假', run('(palindrome? (list 1 2 3))') === false);
ok('palindrome? 空串真', run('(palindrome? "")') === true);
ok('palindrome? 数字回文', run('(palindrome? 12321)') === true);

// ---- string-pad-left / string-pad-right ----
ok('pad-left 补0', run('(string-pad-left "7" 3 "0")') === '007');
ok('pad-left 默认空格', run('(string-pad-left "ab" 4)') === '  ab');
ok('pad-left 已够长原样', run('(string-pad-left "hello" 3 "0")') === 'hello');
ok('pad-right 补-', run('(string-pad-right "ab" 4 "-")') === 'ab--');
ok('pad-right 默认空格', run('(string-pad-right "x" 3)') === 'x  ');
ok('pad-right 负n原样', run('(string-pad-right "ab" -1 "-")') === 'ab');

// ---- doc 注册验证 ----
ok('doc sign 有文档', String(run('(doc (quote sign))')).includes('符号'));
ok('doc palindrome? 有文档', String(run('(doc (quote palindrome?))')).includes('回文'));

console.log(`ci327 numstr: ${pass} passed, ${fail} failed`);
if(fail > 0) process.exit(1);
