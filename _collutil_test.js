// ci191 — Sibilant 集合/序列补充：subvec / replace / zipmap / contains? / conj / select-keys / merge-with / split
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();
const { run } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('  FAIL', name); } }
const arrEq = (a, b)=> JSON.stringify(a) === JSON.stringify(b);

// ---- subvec ----
ok('subvec [1,5) 1 3', arrEq(run('(subvec (list 1 2 3 4 5) 1 3)'), [2,3]));
ok('subvec 单参数到末尾', arrEq(run('(subvec (list 1 2 3 4) 2)'), [3,4]));
ok('subvec 非数组 → []', arrEq(run('(subvec 42 1)'), []));

// ---- replace ----
ok('replace 索引1为9', arrEq(run('(replace (list 1 2 3) 1 9)'), [1,9,3]));
ok('replace 不可变(原列表不变)', arrEq(run('((lambda (xs) (list (replace xs 0 99) xs)) (list 1 2 3))'), [[99,2,3],[1,2,3]]));
ok('replace 越界原样返回', arrEq(run('(replace (list 1 2 3) 9 9)'), [1,2,3]));

// ---- zipmap ----
ok('zipmap → dict-get a', run('(dict-get (zipmap (list (quote a) (quote b)) (list 1 2)) (quote a))') === 1);
ok('zipmap → dict-get b', run('(dict-get (zipmap (list (quote a) (quote b)) (list 1 2)) (quote b))') === 2);
ok('zipmap 以较短者为准', run('(dict-len (zipmap (list (quote a) (quote b) (quote c)) (list 1 2)))') === 2);

// ---- contains? ----
ok('contains? 数组成员', run('(contains? (list 1 2 3) 2)') === true);
ok('contains? 数组非成员', run('(contains? (list 1 2 3) 9)') === false);
ok('contains? dict 键', run('(contains? (dict (quote a) 1) (quote a))') === true);
ok('contains? dict 缺键', run('(contains? (dict (quote a) 1) (quote z))') === false);
ok('contains? 字符串子串', run('(contains? "hello" "ell")') === true);
ok('contains? 字符串非子串', run('(contains? "hello" "xyz")') === false);

// ---- conj ----
ok('conj 数组追加', arrEq(run('(conj (list 1 2) 3)'), [1,2,3]));
ok('conj dict [k v]', run('(dict-get (conj (dict (quote a) 1) (list (quote b) 2)) (quote b))') === 2);
ok('conj 不可变(原数组不变)', arrEq(run('((lambda (ys) (list (conj ys 3) ys)) (list 1 2))'), [[1,2,3],[1,2]]));

// ---- select-keys ----
ok('select-keys 保留 a', run('(dict-get (select-keys (dict (quote a) 1 (quote b) 2) (list (quote a))) (quote a))') === 1);
ok('select-keys 丢弃 b', run('(dict-has? (select-keys (dict (quote a) 1 (quote b) 2) (list (quote a))) (quote b))') === false);

// ---- merge-with ----
ok('merge-with + 冲突键相加', run('(dict-get (merge-with + (dict (quote a) 1) (dict (quote a) 2)) (quote a))') === 3);
ok('merge-with 非冲突键保留', run('(dict-get (merge-with + (dict (quote a) 1) (dict (quote b) 2)) (quote b))') === 2);

// ---- split ----
ok('split 逗号切分', arrEq(run('(split "a,b,c" ",")'), ['a','b','c']));
ok('split 默认空白切分', arrEq(run('(split "a  b\tc")'), ['a','b','c']));

console.log(`collutil: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
