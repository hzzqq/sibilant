// ci430 — Sibilant 代数数据类型：defenum 标签联合 + enum-match 解构
// R1：新增 defenum / enum? / enum-tag / enum-type / enum-fields / enum-vals / enum=? / enum-match
//     （此前缺 tagged union；candidate: 更多数据结构 set/tree 中的枚举联合）
// R2(隐性)：构造器此前无 arity/变体名校验，少传字段与重复变体均静默；现强制校验并抛明确错误。
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

// 1) 无参变体（nullary）
const r1 = run(`(begin
  (defenum Color red green blue)
  (list
    (Color? (Color-red))          ; true
    (enum-tag (Color-red))         ; "red"
    (enum-type (Color-red))        ; "Color"
    (enum=? (Color-red) (Color-red)) ; true
    (enum=? (Color-red) (Color-green)) ; false
    (Color? 5)                     ; false
    (Color-tags)                   ; (red green blue)
  )
)`);
ok('Color-red 是 Color 实例', r1[0] === true);
ok('enum-tag = "red"', r1[1] === 'red');
ok('enum-type = "Color"', r1[2] === 'Color');
ok('enum=? 同变体 true', r1[3] === true);
ok('enum=? 异变体 false', r1[4] === false);
ok('Color? 非实例 false', r1[5] === false);
ok('Color-tags 列出变体', r1[6].length === 3 && r1[6][0].name === 'red');

// 2) 带参变体（payload）+ 字段访问器
const r2 = run(`(begin
  (defenum Shape (circle r) (rect w h))
  (list
    (enum-tag (Shape-circle 5))    ; "circle"
    (Shape-r (Shape-circle 5))     ; 5
    (enum-fields (Shape-rect 3 4)) ; (w h)
    (enum-vals (Shape-rect 3 4))   ; (3 4)
    (Shape? (Shape-rect 3 4))      ; true
  )
)`);
ok('circle 变体 tag', r2[0] === 'circle');
ok('Shape-r 访问字段=5', r2[1] === 5);
ok('enum-fields rect = (w h)', r2[2].length === 2 && r2[2][0].name === 'w');
ok('enum-vals rect = (3 4)', r2[3][0] === 3 && r2[3][1] === 4);
ok('Shape? rect true', r2[4] === true);

// 3) enum-match 解构（带参 + 默认分支）
const m1 = run(`(begin
  (defenum Shape (circle r) (rect w h))
  (defn area (s) (enum-match s
    ((circle r) (* 3.14 (* r r)))
    ((rect w h) (* w h))
    (_ 0)))
  (list (area (Shape-circle 2)) (area (Shape-rect 3 4)))
)`);
ok('enum-match circle 面积=12.56', Math.abs(m1[0] - 12.56) < 1e-9);
ok('enum-match rect 面积=12', m1[1] === 12);

// 4) enum-match 默认分支命中（未知类型）
const m2 = run(`(begin
  (defenum Shape (circle r) (rect w h))
  (enum-match (Shape-circle 1) ((rect w h) 99) (_ -1))
)`);
ok('enum-match 默认分支', m2 === -1);

// 5) R2：arity 校验——带参变体少传字段必须抛错
let threw = false, msg = '';
try { run('(begin (defenum Shape (circle r) (rect w h)) (Shape-rect 1))'); }
catch(e){ threw = true; msg = e.message || ''; }
ok('ctor 参数不足抛错(R2)', threw && /需要 2 个参数/.test(msg));

// 6) R2：重复变体名必须抛错
let threw2 = false;
try { run('(begin (defenum Dup a a))'); }
catch(e){ threw2 = true; }
ok('重复变体名抛错(R2)', threw2);

// 7) enum=? 跨实例字段不同为 false
const eq = run(`(begin
  (defenum Color red green blue)
  (enum=? (Color-red) (Color-green)))`);
ok('enum=? 不同变体 false', eq === false);

console.log(`\nci430 defenum + enum-match: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
