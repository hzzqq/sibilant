// ci127 Sibilant 前缀累积 scan（reductions）测试
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };
const eq = (n, expr, want) => {
  let r; try { r = run(expr); } catch(e){ fail++; console.log('  FAIL', n, '->', e.message); return; }
  ok(n + '  => ' + lispStr(r), lispStr(r) === want);
};

// 前缀和：(0 1 3 6)
eq('scan + 前缀和', "(scan + 0 '(1 2 3))", '(0 1 3 6)');
// 前缀积：(1 1 2 6 24)
eq('scan * 前缀积', "(scan * 1 '(1 2 3 4))", '(1 1 2 6 24)');
// 空列表：仅含初始值
eq('scan 空列表 => (init)', '(scan + 0 (list))', '(0)');
// 非列表：仅含初始值（不报错）
eq('scan 非列表 => (init)', '(scan + 0 5)', '(0)');
// 任意函数（用 cons 反向前缀）：(() (a) (b a) (c b a))
eq('scan 自定义 f', "(scan (lambda (a b) (cons b a)) (list) '(a b c))", '(() (a) (b a) (c b a))');
// 长度 = len(xs) + 1
eq('scan 长度 = n+1', '(length (scan + 0 \'(1 2 3)))', '4');
// 与 reduce 一致：末元素等于 reduce 结果
eq('scan 末值 = reduce', "(last (scan + 0 '(1 2 3 4)))", '10');
// 文档登记
ok('doc scan 含「前缀累积」', run('(doc (quote scan))').indexOf('前缀累积') >= 0);

console.log(`\nci127 scan: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
