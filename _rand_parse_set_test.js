// ci199 — Sibilant 随机/解析/输出/集合关系：every / rand / rand-int / parse-int / parse-float
// / pr-str / prn / subset? / intersection / union / difference / sym-diff
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('  FAIL', name); } }
const arrEq = (a, b)=> JSON.stringify(a) === JSON.stringify(b);

// every
ok('every 全满足 => #t', run('(every pos? (list 1 2 3))') === true);
ok('every 有不满足 => #f', run('(every pos? (list 1 -2 3))') === false);
ok('every 空集 => #t', run('(every pos? (list))') === true);
ok('every 非列表 => #f', run('(every pos? 5)') === false);

// rand / rand-int
const r1 = run('(rand)');
ok('rand 在 [0,1)', typeof r1 === 'number' && r1 >= 0 && r1 < 1);
let riOk = true;
for(let i=0;i<20;i++){ const v = run('(rand-int 10)'); if(!Number.isInteger(v) || v < 0 || v >= 10) riOk = false; }
ok('rand-int 20 次均在 [0,10) 整数', riOk);

// parse-int / parse-float
ok('parse-int "42" => 42', run('(parse-int "42")') === 42);
ok('parse-int "1010" 2 => 10', run('(parse-int "1010" 2)') === 10);
ok('parse-int 非法 => null', run('(parse-int "xyz")') === null);
ok('parse-float "3.14" => 3.14', run('(parse-float "3.14")') === 3.14);
ok('parse-float 非法 => null', run('(parse-float "zz")') === null);

// pr-str / prn
ok('pr-str (list 1 2) => "(1 2)"', run('(pr-str (list 1 2))') === '(1 2)');
ok('pr-str 42 => "42"', run('(pr-str 42)') === '42');
let prnOut = null; const _log = console.log; console.log = (...a)=>{ prnOut = (prnOut ? prnOut + ' ' : '') + a.join(' '); };
const prnRet = run('(prn "hi" 1)');
console.log = _log;
ok('prn 返回 null', prnRet === null);
ok('prn 输出含 hi 与 1', prnOut && prnOut.indexOf('hi') >= 0 && prnOut.indexOf('1') >= 0);

// subset?
ok('subset? (set 1) (set 1 2) => #t', run('(subset? (set 1) (set 1 2))') === true);
ok('subset? (set 1 2) (set 1) => #f', run('(subset? (set 1 2) (set 1))') === false);
let threw = false; try { run('(subset? (list 1) (set 1))'); } catch(e){ threw = true; }
ok('subset? 非 set 抛错', threw);

// intersection / union / difference / sym-diff
ok('intersection', arrEq(run('(intersection (list 1 2 3) (list 2 3 4))'), [2,3]));
ok('union', arrEq(run('(union (list 1 2) (list 2 3))'), [1,2,3]));
ok('difference', arrEq(run('(difference (list 1 2 3) (list 2))'), [1,3]));
ok('sym-diff', arrEq(run('(sym-diff (list 1 2) (list 2 3))'), [1,3]));
ok('intersection 列表与 set 互通', arrEq(run('(intersection (list 2 3) (set 1 2 3))'), [2,3]));
ok('union 空', arrEq(run('(union (list) (list))'), []));

console.log(`rand_parse_set: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
