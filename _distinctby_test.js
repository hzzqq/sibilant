// ci231 — Sibilant 高阶序列/谓词组合：distinct-by / some-fn / every-pred
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL:', n); } };

// distinct-by：按键函数去重，保留首次出现
ok('distinct-by 按符号去重 (1 2 3 4 5)=>(1 2 3)', lispStr(run('(distinct-by (lambda (x) (if (< x 0) -1 1)) (list -3 -1 2 5))')) === '(-3 2)');
ok('distinct-by 保持原顺序', lispStr(run('(distinct-by (lambda (x) (mod (floor x) 2)) (list 1.2 1.9 2.1 2.8 3.0))')) === '(1.2 2.1)');
ok('distinct-by 空列表 => ()', lispStr(run('(distinct-by (lambda (x) x) (list))')) === '()');
ok('distinct-by 无重复则原样返回', lispStr(run('(distinct-by (lambda (x) x) (list 1 2 3))')) === '(1 2 3)');
ok('distinct-by 保留的不是 key 而是原元素', lispStr(run('(distinct-by (lambda (x) (if (< x 0) -1 1)) (list -3 -1 2 5))')) === '(-3 2)');

// some-fn：谓词析取，返回新谓词
ok('some-fn 在 filter 中工作 (-2 -1 0 1 2)=>(-2 0 1 2)', lispStr(run('(filter (some-fn even? pos?) (list -2 -1 0 1 2))')) === '(-2 0 1 2)');
ok('some-fn 直接调用 负奇数 => #f', run('((some-fn even? pos?) -1)') === false);
ok('some-fn 直接调用 正数 => #t', run('((some-fn even? pos?) 3)') === true);
ok('some-fn 直接调用 0(偶数) => #t', run('((some-fn even? pos?) 0)') === true);
ok('some-fn 单谓词', run('((some-fn even?) 4)') === true && run('((some-fn even?) 3)') === false);

// every-pred：谓词合取，返回新谓词
ok('every-pred 在 filter 中工作 (-1 0 1 2 3 4)=>(2 4)', lispStr(run('(filter (every-pred pos? even?) (list -1 0 1 2 3 4))')) === '(2 4)');
ok('every-pred 直接调用 4(正且偶) => #t', run('((every-pred pos? even?) 4)') === true);
ok('every-pred 直接调用 3(正非偶) => #f', run('((every-pred pos? even?) 3)') === false);
ok('every-pred 直接调用 -1(非正) => #f', run('((every-pred pos? even?) -1)') === false);
ok('every-pred 单谓词', run('((every-pred pos?) 2)') === true && run('((every-pred pos?) -2)') === false);

// ---- 接线检查 ----
const src = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
ok("interpreter.js 定义 distinct-by", /def\('distinct-by'/.test(src));
ok("interpreter.js 定义 some-fn", /def\('some-fn'/.test(src));
ok("interpreter.js 定义 every-pred", /def\('every-pred'/.test(src));

console.log(`distinctby: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
