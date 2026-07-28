// ci446 — memoize-by（自定义键记忆化） + regex-* 旧族统一委托 re-*（修复函数替换器失效 + 约定一致）
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

// ---- memoize-by（R1 新需求）----
ok('memoize-by 首次计算入缓存', run('(let ((f (memoize-by (lambda (a b) (+ a b)) (lambda (a b) (+ a b))))) (begin (f 1 2) (memo-cache-size f)))') === 1);
ok('memoize-by 同键归一化共享缓存', run('(let ((f (memoize-by (lambda (a b) (+ a b)) (lambda (a b) (+ a b))))) (begin (f 1 2) (f 2 1) (memo-cache-size f)))') === 1);  // (1 2)/(2 1) 键同为 3
ok('memoize-by 结果正确', run('(let ((f (memoize-by (lambda (a b) (+ a b)) (lambda (a b) (+ a b))))) (f 2 1))') === 3);
ok('memoize-by 无 keyfn 退化为按参缓存', run('(let ((g (memoize-by (lambda (x) (+ x 1))))) (begin (g 10) (g 10) (memo-cache-size g)))') === 1);
ok('memoized? 识别记忆化函数', run('(let ((f (memoize-by (lambda (x) x)))) (memoized? f))') === true);
ok('memoized? 非记忆化返回 #f', run('(memoized? +)') === false);

// ---- regex-* 旧族统一委托 re-*（R2 隐性修复）----
// 修复：regex-replace 曾把函数替换器直接 String() 导致回调失效
eq('regex-replace 函数替换器(修复)', '(regex-replace "[0-9]+" "a12b3" (lambda (m) (string-append "[" m "]")))', '"a[12]b[3]"');
eq('regex-replace 字符串', '(regex-replace "[0-9]" "a1b2" "#")', '"a#b#"');
// regex-match 应与 re-find 一致：命中返回列表、未命中 #f（此前返回 null/JS 数组）
eq('regex-match 命中返回列表', '(regex-match "[0-9]+" "ab12c")', '("12")');
ok('regex-match 未命中返回 #f', run('(regex-match "x" "abc")') === false);
eq('regex-find-all 全部', '(regex-find-all "[0-9]+" "a1b22c333")', '("1" "22" "333")');
eq('regex-split', '(regex-split "[, ]+" "a b, c")', '("a" "b" "c")');
ok('regex-test 命中', run('(regex-test "[0-9]" "a1")') === true);
ok('regex-test 未命中', run('(regex-test "[9]" "a1")') === false);

// 回归：re-* 规范 API 不受影响
eq('re-replace lambda 回归', '(re-replace "[0-9]+" "a12b3" (lambda (m) (string-append "[" m "]")))', '"a[12]b[3]"');
ok('docs 含 memoize-by', run('(docs)').indexOf('memoize-by') >= 0);

console.log(`_ci446_memoize_regex: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
