// ci155 Sibilant 基础列表访问器 —— first / second / third / rest / butlast / not-empty 行为测试
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c)=> { if(c) pass++; else { fail++; console.log('  FAIL:', n); } };
const eq = (n, expr, want)=> {
  let r; try { r = run(expr); } catch(e){ fail++; console.log('  FAIL', n, '->', e.message); return; }
  ok(n + '  => ' + lispStr(r), JSON.stringify(lispStr(r)) === JSON.stringify(want));
};

// first：取首元素
eq('first 三项', '(first (list 1 2 3))', '1');
eq('first 空列表', '(first (list))', '()');
eq('first 非列表', '(first 5)', '()');

// second / third：取第 2 / 3 元素
eq('second 三项', '(second (list 1 2 3))', '2');
eq('third 三项', '(third (list 1 2 3))', '3');
eq('third 不足三项', '(third (list 1 2))', '()');

// rest：除首外其余
eq('rest 三项', '(rest (list 1 2 3))', '(2 3)');
eq('rest 单项', '(rest (list 1))', '()');

// butlast：除末外其余
eq('butlast 三项', '(butlast (list 1 2 3))', '(1 2)');
eq('butlast 单项', '(butlast (list 1))', '()');

// not-empty：非空判定
eq('not-empty 有元素', '(not-empty (list 1))', '#t');
eq('not-empty 空列表', '(not-empty (list))', '#f');
eq('not-empty 空串', '(not-empty "")', '#f');
eq('not-empty 非空串', '(not-empty "a")', '#t');

// 组合：rest + second
eq('second∘rest', '(second (rest (list 1 2 3)))', '3');

// 文档登记
ok('doc first 含「首」', run('(doc (quote first))').indexOf('首') >= 0);
ok('doc rest 含「其余」', run('(doc (quote rest))').indexOf('其余') >= 0);
ok('doc butlast 含「末」', run('(doc (quote butlast))').indexOf('末') >= 0);
ok('doc not-empty 含「非空」', run('(doc (quote not-empty))').indexOf('非空') >= 0);
ok('docs 含 6 个新函数', ['first','second','third','rest','butlast','not-empty'].every(n=> run('(docs)').indexOf(n) >= 0));

console.log('lang/_accessors_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
