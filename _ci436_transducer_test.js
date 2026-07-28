// ci436 — Sibilant transducer 转化管线（R1 全新能力：transduce + xmap/xfilter/xtake/xdrop，可 comp 组合）
// R2(隐性)：此前 Sibilant 缺少通用的“列表→归约”转化管线，只能逐个函数拼装；transducer 提供与 comp 组合的复用抽象。
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

// 1) xmap：映射后求和
ok('xmap double sum', run('(transduce (xmap (lambda (x) (* x 2))) + 0 (list 1 2 3))') === 12);
// 2) xfilter：偶数求和
ok('xfilter even sum', run('(transduce (xfilter even?) + 0 (list 1 2 3 4))') === 6);
// 3) xtake：取前 2 求和
ok('xtake 2 sum', run('(transduce (xtake 2) + 0 (list 1 2 3))') === 3);
// 4) xdrop：丢前 1 求和
ok('xdrop 1 sum', run('(transduce (xdrop 1) + 0 (list 1 2 3))') === 5);
// 5) comp 组合：先 +1 再过滤偶数（(2 3 4 5) -> 2,4 -> 6）
ok('comp xmap+xfilter', run('(transduce (comp (xmap (lambda (x)(+ x 1))) (xfilter even?)) + 0 (list 1 2 3 4))') === 6);
// 6) 组合三段：map 平方 -> filter 偶数 -> take 2 -> 收集为列表（conj 追加，保持输入顺序）
ok('comp 3-stage collect', JSON.stringify(run('(transduce (comp (xmap (lambda (x)(* x x))) (xfilter even?) (xtake 2)) conj (list) (list 1 2 3 4 5))')) === '[4,16]');
// 7) 单元素/空集合边界
ok('xtake over empty', run('(transduce (xtake 5) + 0 (list))') === 0);
ok('xfilter none match', run('(transduce (xfilter (lambda (x)(> x 100))) + 0 (list 1 2 3))') === 0);

console.log(`\nci436 transducer: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
