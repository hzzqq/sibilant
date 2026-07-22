// ci211 — Sibilant 字符串/集合补充：join / upper / lower / trim / blank? / coll?
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
const T = '#t', F = '#f';

// join
ok('join 数字列表 ","', run('(join (list 1 2 3) ",")') === '1,2,3');
ok('join 字符串 "-"', run('(join (list "a" "b") "-")') === 'a-b');
ok('join 空列表 => ""', run('(join (list) ",")') === '');
ok('join 空表元素视作空串', run('(join (list 1 (list) 3) "-")') === '1--3');
ok('join 空分隔 => 直接拼接', run('(join (list 1 2) "")') === '12');

// upper / lower / trim
ok('upper', run('(upper "hi")') === 'HI');
ok('lower', run('(lower "HI")') === 'hi');
ok('trim', run('(trim "  x  ")') === 'x');
ok('trim 内部不变', run('(trim "a b")') === 'a b');

// blank?
eq('blank? ""', '(blank? "")', T);
eq('blank? "  "', '(blank? "  ")', T);
eq('blank? ()', '(blank? ())', T);
eq('blank? 5', '(blank? 5)', F);
eq('blank? "x"', '(blank? "x")', F);

// coll?
eq('coll? list', '(coll? (list 1))', T);
eq('coll? set', '(coll? (set 1))', T);
eq('coll? dict', '(coll? (dict (quote a) 1))', T);
eq('coll? 5', '(coll? 5)', F);
eq('coll? "x"', '(coll? "x")', F);

// 文档登记
ok('doc join 含「连接」', run('(doc (quote join))').indexOf('连接') >= 0);
ok('doc blank? 含「空白」', run('(doc (quote blank?))').indexOf('空白') >= 0);
ok('doc coll? 含「集合」', run('(doc (quote coll?))').indexOf('集合') >= 0);

console.log(`\nci211 strcoll: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
