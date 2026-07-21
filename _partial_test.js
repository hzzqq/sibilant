// ci111 Sibilant 偏应用 partial —— 行为测试
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

// 固定前两个参数
eq('partial 前缀 + 后缀', '((partial (lambda (a b c) (list a b c)) 1 2) 3)', '(1 2 3)');
// 仅固定一个
eq('partial 固定 1 个', '((partial + 10) 5)', '15');
// 无前缀等价原函
eq('partial 空前缀', '((partial (lambda (x) (* x 2))) 4)', '8');
// 用于 map
eq('partial 用于 map', '(map (partial + 100) (list 1 2 3))', '(101 102 103)');
// 与内置组合：固定 cons 的头部
eq('partial cons 头', '((partial cons 9) (list 1 2))', '(9 1 2)');
// 文档登记
ok('doc partial 含「偏应用」', run('(doc (quote partial))').indexOf('偏应用') >= 0);

console.log(`\nci111 partial: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
