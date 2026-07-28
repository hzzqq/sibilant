// ci441 Sibilant 正则能力 + frequencies 隐性 bug 修复回归测试
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

// ---- re-find ----
eq('re-find 基本', '(re-find "[0-9]+" "ab12c")', '("12")');
eq('re-find 含捕获组', '(re-find "([a-z]+)([0-9]+)" "x42")', '("x42" "x" "42")');
ok('re-find 未命中返回 #f', run('(re-find "x" "abc")') === false);
ok('re-find 非字符串安全降级 #f', run('(re-find "[0-9]" 123)') === false);

// ---- re-matches（整串精确匹配）----
eq('re-matches 命中', '(re-matches "^[0-9]+$" "123")', '("123")');
eq('re-matches 无锚点整串', '(re-matches "[0-9]+" "123")', '("123")');
ok('re-matches 部分不匹配返回 #f', run('(re-matches "^[0-9]+$" "123a")') === false);

// ---- re-seq ----
eq('re-seq 全部', '(re-seq "[0-9]+" "a1b22c333")', '("1" "22" "333")');
ok('re-seq 非字符串安全降级空列表', Array.isArray(run('(re-seq "[0-9]+" 123)')) && run('(re-seq "[0-9]+" 123)').length === 0);

// ---- re-replace ----
eq('re-replace 字符串', '(re-replace "[0-9]" "a1b2" "#")', '"a#b#"');
eq('re-replace lambda', '(re-replace "[0-9]+" "a12b3" (lambda (m) (string-append "[" m "]")))', '"a[12]b[3]"');
eq('re-replace lambda 捕获组透传', '(re-replace "([0-9]+)" "a12" (lambda (m g) g))', '"a12"');

// ---- frequencies 隐性 bug 回归：必须返回 Dict（此前 def 版本返回数组且与预置库矛盾）----
eq('frequencies 基本返回 Dict', '(frequencies (list 1 1 2))', '#{1 2 2 1}');
eq('frequencies 嵌套键', '(frequencies (list (list 1) (list 1) (list 2)))', '#{(1) 2 (2) 1}');
ok('docs 含 re-find', run('(docs)').indexOf('re-find') >= 0);
ok('docs 含 frequencies', run('(docs)').indexOf('frequencies') >= 0);

console.log(`_ci441_regex: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
