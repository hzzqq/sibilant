// ci195 — Sibilant 字符/字符串/集合补充：char-code / code-char / capitalize / string-triml / string-trimr / superset? / distinct? / juxt / keep-indexed
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();
const { run } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('  FAIL', name); } }
const arrEq = (a, b)=> JSON.stringify(a) === JSON.stringify(b);

// ---- char-code / code-char ----
ok('char-code "A"', run('(char-code "A")') === 65);
ok('char-code "a"', run('(char-code "a")') === 97);
ok('char-code "0"', run('(char-code "0")') === 48);
ok('code-char 65', run('(code-char 65)') === 'A');
ok('code-char 97', run('(code-char 97)') === 'a');
ok('char-code/code-char 往返', run('(code-char (char-code "Z"))') === 'Z');

// ---- capitalize ----
ok('capitalize 混合', run('(capitalize "hELLo")') === 'Hello');
ok('capitalize 全大写', run('(capitalize "ABC")') === 'Abc');
ok('capitalize 空串', run('(capitalize "")') === '');

// ---- string-triml / string-trimr ----
ok('string-triml', run('(string-triml "  ab")') === 'ab');
ok('string-triml 无空白', run('(string-triml "ab")') === 'ab');
ok('string-trimr', run('(string-trimr "ab  ")') === 'ab');
ok('string-trimr 无空白', run('(string-trimr "ab")') === 'ab');

// ---- superset? ----
ok('superset? 真', run('(superset? (set 1 2 3) (set 2))') === true);
ok('superset? 假', run('(superset? (set 1) (set 1 2))') === false);
ok('superset? 空集是超集', run('(superset? (set 1 2 3) (set))') === true);

// ---- distinct? ----
ok('distinct? 互异', run('(distinct? (list 1 2 3))') === true);
ok('distinct? 有重复', run('(distinct? (list 1 1 2))') === false);
ok('distinct? 空列表', run('(distinct? (list))') === true);

// ---- juxt ----
ok('juxt inc dec 5', arrEq(run('((juxt inc dec) 5)'), [6,4]));
ok('juxt 三函数', arrEq(run('((juxt inc inc inc) 1)'), [2,2,2]));

// ---- keep-indexed ----
ok('keep-indexed 首元素', arrEq(run('(keep-indexed (lambda (i x) (= i 0)) (list 1 2 3))'), [1]));
ok('keep-indexed 偶数索引', arrEq(run('(keep-indexed (lambda (i x) (= (mod i 2) 0)) (list 1 2 3 4))'), [1,3]));

console.log(`strchar: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
