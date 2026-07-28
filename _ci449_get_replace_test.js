// ci449 — 通用取值 get (R1 新能力) + replace 支持字符串按索引替换 (R2 隐性修复)
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; } else { fail++; console.log('  FAIL ' + name + '  got=' + g + ' want=' + w); } };

// ---------- R1: get 通用取值 ----------
eq('get dict 命中', run('(get (dict (quote a) 1) (quote a))'), 1);
eq('get dict 缺失带默认', run('(get (dict (quote a) 1) (quote z) 9)'), 9);
eq('get dict 缺失无默认 => null', run('(get (dict (quote a) 1) (quote z))'), null);
ok('get dict 符号键归一化(lispStr)', run('(get (dict (quote a) 1) \'a)') === 1);
eq('get 列表按索引', run('(get (list 1 2 3) 1)'), 2);
eq('get 列表越界带默认', run('(get (list 1 2 3) 9 0)'), 0);
eq('get 字符串按索引', run('(get "abc" 0)'), 'a');
eq('get 字符串越界带默认', run('(get "abc" 9 "x")'), 'x');
eq('get 非容器带默认', run('(get 42 (quote k) "d")'), 'd');

// ---------- R2: replace 支持字符串按索引替换(此前字符串静默返回 []) ----------
eq('replace 列表索引1为9', run('(replace (list 1 2 3) 1 9)'), [1, 9, 3]);
eq('replace 字符串索引1替换', run('(replace "abc" 1 "X")'), 'aXc');
eq('replace 字符串数字val被String化', run('(replace "abc" 0 9)'), '9bc');
eq('replace 列表越界原样返回', run('(replace (list 1 2 3) 9 9)'), [1, 2, 3]);
eq('replace 字符串越界原样返回', run('(replace "abc" 9 "Z")'), 'abc');
ok('replace 不可变(原列表不变)', (() => {
  const r = run('((lambda (xs) (list (replace xs 0 99) xs)) (list 1 2 3))');
  return JSON.stringify(r) === JSON.stringify([[99, 2, 3], [1, 2, 3]]);
})());

console.log(`[Sibilant ci449 get+replace] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
