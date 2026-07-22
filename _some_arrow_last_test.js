// _some_arrow_last_test.js — Sibilant some->> (ci299) 单元测试 + 隐性问题(format 行尾~)验证
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/interpreter.js', 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

// ---- some->> (特殊形式，尾插 nil 短路) ----
ok('some->> 正常', lispStr(run('(some->> 3 (list) (map inc))')) === '(4)');
ok('some->> 空序列短路', lispStr(run('(some->> (list) rest (map inc))')) === '()');
ok('some->> 链式', lispStr(run('(some->> 1 (list) (map (lambda (x) (* x 2))) (filter even?))')) === '(2)');

// ---- R2 隐性问题：format 行尾单独 ~ 曾输出 "~undefined"，现在视为字面量 ----
ok('format 行尾~ 字面量', run('(format "abc~")') === 'abc~');
ok('format 中间~保留', run('(format "a~b")') === 'a~b');
ok('format 正常~a', run('(format "x=~a" 1)') === 'x=1');
ok('format 正常~%', run('(format "a~%b")') === 'a\nb');

console.log(`some->>: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
