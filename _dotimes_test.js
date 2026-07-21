// ci115 Sibilant 计数循环 dotimes —— 行为测试
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };
const eq = (n, expr, want) => {
  let r; try { r = run(expr); } catch(e){ fail++; console.log('  FAIL', n, '->', e.message); return; }
  ok(n + '  => ' + lispStr(r), JSON.stringify(lispStr(r)) === JSON.stringify(want));
};

// 累加 0+1+2 = 3
eq('dotimes 累加', '(let ((s 0)) (dotimes (i 3) (set! s (+ s i))) s)', '3');
// 收集列表 (0 1 2)
eq('dotimes 收集', '(define xs (list)) (dotimes (i 3) (set! xs (cons i xs))) xs', '(2 1 0)');
// 返回最后一次体的值
eq('dotimes 返回末次', '(dotimes (i 4) i)', '3');
// 次数 <= 0 返回 null（Sibilant 的 null 渲染为 '()'）
eq('dotimes 0 次 => null()', '(dotimes (i 0) 99)', '()');
// 次数表达式为计算值
eq('dotimes 次数表达式', '(dotimes (i (+ 1 2)) i)', '2');
// 计数器作用域隔离（外部同名不被污染）
eq('计数器作用域', '(let ((i 100)) (dotimes (i 2) i) i)', '100');
// 文档登记
ok('doc dotimes 含「计数循环」', run('(doc (quote dotimes))').indexOf('计数循环') >= 0);

console.log(`\nci115 dotimes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
