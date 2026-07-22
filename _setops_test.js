// ci163 — Sibilant 集合运算扩展：set-difference / set-subset? / set-symmetric-difference
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();

const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('  FAIL', name); } }
function runOrErr(src){ try { return { v: run(src), err: null }; } catch(e){ return { v: null, err: e }; } }

// ---- set-difference ----
ok('差集 长度 2', run('(set-len (set-difference (set 1 2 3) (set 2 4)))') === 2);
ok('差集 含 1', run('(set-has? (set-difference (set 1 2 3) (set 2 4)) 1)') === true);
ok('差集 含 3', run('(set-has? (set-difference (set 1 2 3) (set 2 4)) 3)') === true);
ok('差集 不含 2', run('(set-has? (set-difference (set 1 2 3) (set 2 4)) 2)') === false);
ok('差集 不含 4', run('(set-has? (set-difference (set 1 2 3) (set 2 4)) 4)') === false);
ok('差集 自身减自身为空', run('(set-len (set-difference (set 1 2 3) (set 1 2 3)))') === 0);
ok('差集 A 减空集 = A', run('(set-len (set-difference (set 1 2 3) (set)))') === 3);

// ---- set-subset? ----
ok('子集 (1 2)⊆(1 2 3)', run('(set-subset? (set 1 2) (set 1 2 3))') === true);
ok('非子集 (1 2)⊆(1)', run('(set-subset? (set 1 2) (set 1))') === false);
ok('空集是任何集的子集', run('(set-subset? (set) (set 5 6))') === true);
ok('相等集合互为子集', run('(set-subset? (set 1 2 3) (set 1 2 3))') === true);
ok('子集 (set)⊆(set)', run('(set-subset? (set 7) (set 7))') === true);

// ---- set-symmetric-difference ----
ok('对称差 长度 2', run('(set-len (set-symmetric-difference (set 1 2 3) (set 2 3 4)))') === 2);
ok('对称差 含 1', run('(set-has? (set-symmetric-difference (set 1 2 3) (set 2 3 4)) 1)') === true);
ok('对称差 含 4', run('(set-has? (set-symmetric-difference (set 1 2 3) (set 2 3 4)) 4)') === true);
ok('对称差 不含 2', run('(set-has? (set-symmetric-difference (set 1 2 3) (set 2 3 4)) 2)') === false);
ok('对称差 不含 3', run('(set-has? (set-symmetric-difference (set 1 2 3) (set 2 3 4)) 3)') === false);
ok('对称差 自身对称自身为空', run('(set-len (set-symmetric-difference (set 1 2) (set 1 2)))') === 0);

// ---- 不可变：运算不改变入参（同一 begin 内定义并使用，返回长度对）----
const imm = run('(begin (define __a (set 1 2 3)) (define __b (set 2 4)) (set-difference __a __b) (set-symmetric-difference __a __b) (list (set-len __a) (set-len __b)))');
ok('差集不修改入参 A/B', lispStr(imm) === '(3 2)');

// ---- 错误分支：非 set 入参抛错 ----
ok('set-difference 非 set 抛错', runOrErr('(set-difference 1 2)').err !== null);
ok('set-subset? 非 set 抛错', runOrErr('(set-subset? 1 (set 2))').err !== null);
ok('set-symmetric-difference 非 set 抛错', runOrErr('(set-symmetric-difference (set 1) 2)').err !== null);

// ---- 接线：doc 注册 ----
ok('doc set-difference', run('(doc "set-difference")') !== null);
ok('doc set-subset?', run('(doc "set-subset?")') !== null);
ok('doc set-symmetric-difference', run('(doc "set-symmetric-difference")') !== null);

console.log(`lang/_setops_test.js  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
