// ci438 — Sibilant 惰性序列 生成与变换（R1 全新：lazy-iterate / lazy-repeat / lazy-cycle / lazy-map / lazy-filter / lazy-nth）
// R2(隐性)：forcePromise 增强支持 JS 闭包作为惰性尾部（向后兼容），使惰性序列可用普通闭包构建，无需 env。
// R3：forcePromise 增加函数分支，提升惰性求值与宿主 JS 的互操作。
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
global.require = require;
new Function(code)();
const S = global.window.Sibilant;
if (!S || typeof S.run !== 'function') { console.error('FAIL: runtime'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }
const run = (s)=> S.run(s);
const eq = (a, b)=> JSON.stringify(a) === JSON.stringify(b);

// 生成器
ok('lazy-iterate take3', eq(run('(lazy-take 3 (lazy-iterate (lambda (x)(+ x 1)) 0))'), [0,1,2]));
ok('lazy-repeat take3', eq(run('(lazy-take 3 (lazy-repeat 7))'), [7,7,7]));
ok('lazy-cycle take5', eq(run('(lazy-take 5 (lazy-cycle (list 1 2 3)))'), [1,2,3,1,2]));

// 变换
ok('lazy-map take3', eq(run('(lazy-take 3 (lazy-map (lambda (x)(* x 2)) (lazy-repeat 1)))'), [2,2,2]));
ok('lazy-filter odd take2', eq(run('(lazy-take 2 (lazy-filter odd? (lazy-iterate (lambda (x)(+ x 1)) 0)))'), [1,3]));
ok('lazy-filter cycle even take3', eq(run('(lazy-take 3 (lazy-filter (lambda (x)(even? x)) (lazy-cycle (list 1 2 3 4))))'), [2,4,2]));

// 取第 n
ok('lazy-nth 4', run('(lazy-nth 4 (lazy-iterate (lambda (x)(+ x 1)) 0))') === 4);
ok('lazy-nth of finite', run('(lazy-nth 1 (lazy-cons 10 (lazy-cons 20 ())))') === 20);
ok('lazy-nth infinite repeat', run('(lazy-nth 9 (lazy-repeat 1))') === 1);

// 惰性保持：映射无限序列后再取，不应挂起/溢出
ok('lazy-map infinite safe', eq(run('(lazy-take 4 (lazy-map (lambda (x)(+ x 10)) (lazy-iterate (lambda (x)(+ x 1)) 0)))'), [10,11,12,13]));

// 回归：既有 lazy-cons / force / lazy-car 仍正常（验证 forcePromise 改动向后兼容）
ok('lazy-cons car', run('(lazy-car (lazy-cons 1 ()))') === 1);
ok('force delay', run('(force (delay 42))') === 42);
ok('lazy-cdr', eq(run('(lazy-take 2 (lazy-cdr (lazy-cons 1 (lazy-cons 2 (lazy-cons 3 ())))))'), [2,3]));

console.log(`\nci438 lazy: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
