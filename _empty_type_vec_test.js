// ci203 — Sibilant 集合构造/类型/数值补充：empty / type / vec / into / get-in / assoc-in /
// dissoc-in / rem / quot / atan
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();
const { run } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('  FAIL', name); } }
const arrEq = (a, b)=> JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, e=1e-4)=> Math.abs(a-b) <= e;

// empty
ok('empty list => []', arrEq(run('(empty (list 1 2))'), []));
const ed = run('(empty (dict (quote a) 1))');
ok('empty dict len 0', ed && ed.len === 0);
ok('empty set len 0', run('(empty (set 1 2))').len === 0);

// type
ok('type 5 => number', run('(type 5)') === 'number');
ok('type "x" => string', run('(type "x")') === 'string');
ok('type (list 1) => list', run('(type (list 1))') === 'list');
ok('type (dict) => dict', run('(type (dict (quote a) 1))') === 'dict');
ok('type (set) => set', run('(type (set 1))') === 'set');
ok('type #t => bool', run('(type #t)') === 'bool');
ok('type lambda => object(fn 在 Sibilant 以对象表示)', run('(type (lambda () 1))') === 'object');

// vec
ok('vec list => 副本', arrEq(run('(vec (list 1 2 3))'), [1,2,3]));
ok('vec set => 元素列表', arrEq(run('(vec (set 1 2))').slice().sort(), [1,2]));

// into
ok('into list+list', arrEq(run('(into (list 1) (list 2 3))'), [1,2,3]));
ok('into dict+对', run('(get-in (into (dict) (list (list (quote a) 1) (list (quote b) 2))) (list (quote a)))') === 1);
ok('into set+list', run('(contains? (into (set) (list 1 2)) 2)') === true);

// get-in / assoc-in / dissoc-in
const nested = '(dict (quote a) (dict (quote b) 1))';
ok('get-in 命中', run('(get-in ' + nested + ' (list (quote a) (quote b)))') === 1);
const ai = '(assoc-in (dict) (list (quote a) (quote b)) 9)';
ok('assoc-in 写入嵌套', run('(get-in ' + ai + ' (list (quote a) (quote b)))') === 9);
const di = '(dissoc-in ' + nested + ' (list (quote a) (quote b)))';
ok('dissoc-in 外层 a 仍在', run('(contains? ' + di + ' (quote a))') === true);
ok('dissoc-in 最内层 b 已删', run('(contains? (get-in ' + di + ' (list (quote a))) (quote b))') === false);

// rem / quot
ok('rem 7 3 => 1', run('(rem 7 3)') === 1);
ok('rem -7 3 => -1', run('(rem -7 3)') === -1);
ok('rem 7 0 => 0(不崩)', run('(rem 7 0)') === 0);
ok('quot 7 3 => 2', run('(quot 7 3)') === 2);
ok('quot -7 3 => -2', run('(quot -7 3)') === -2);
ok('quot 7 0 => 0(不崩)', run('(quot 7 0)') === 0);

// atan
ok('atan 1 ≈ 0.7854', near(run('(atan 1)'), 0.7853981633974483));
ok('atan 1 0 ≈ 1.5708', near(run('(atan 1 0)'), 1.5707963267948966));
ok('atan 0 1 ≈ 0', near(run('(atan 0 1)'), 0));

console.log(`empty_type_vec: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
