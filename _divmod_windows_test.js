// ci175 — Sibilant 数值/字符串/列表补全：divmod / trunc / string-blank? / chars / list->string / windows
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();

const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('  FAIL', name); } }

// ---- divmod ----
ok('divmod 17 5', lispStr(run('(divmod 17 5)')) === '(3 2)');
ok('divmod -17 5', lispStr(run('(divmod -17 5)')) === '(-3 -2)');
ok('divmod 7 3', lispStr(run('(divmod 7 3)')) === '(2 1)');

// ---- trunc ----
ok('trunc -3.7', run('(trunc -3.7)') === -3);
ok('trunc 2.9', run('(trunc 2.9)') === 2);
ok('trunc 5', run('(trunc 5)') === 5);

// ---- string-blank? ----
ok('blank 空串', run('(string-blank? "")') === true);
ok('blank 全空白', run('(string-blank? "  ")') === true);
ok('blank 非空', run('(string-blank? "a")') === false);

// ---- chars / list->string ----
ok('chars abc', lispStr(run('(chars "abc")')) === '("a" "b" "c")');
ok('list->string 还原', run('(list->string (chars "hi"))') === 'hi');
ok('chars 中文', lispStr(run('(chars "中x")')) === '("中" "x")');

// ---- windows ----
ok('windows 2', lispStr(run('(windows 2 (list 1 2 3 4))')) === '((1 2) (2 3) (3 4))');
ok('windows 长度不足返回空', lispStr(run('(windows 5 (list 1 2 3))')) === '()');
ok('windows 1', lispStr(run('(windows 1 (list 1 2 3))')) === '((1) (2) (3))');

// ---- 接线：doc 注册 ----
ok('doc divmod', run('(doc "divmod")') !== null);
ok('doc trunc', run('(doc "trunc")') !== null);
ok('doc string-blank?', run('(doc "string-blank?")') !== null);
ok('doc chars', run('(doc "chars")') !== null);
ok('doc list->string', run('(doc "list->string")') !== null);
ok('doc windows', run('(doc "windows")') !== null);

console.log(`lang/_divmod_windows_test.js  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
