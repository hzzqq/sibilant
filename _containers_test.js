// ci215 — Sibilant 通用容器工具：keys / vals / count / dissoc / str（多态于 dict/set/序列）
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c)=> { if(c) pass++; else { fail++; console.log('  FAIL:', n); } };
const eq = (n, expr, want)=> {
  let r; try { r = run(expr); } catch(e){ fail++; console.log('  FAIL', n, '->', e.message); return; }
  ok(n + '  => ' + lispStr(r), JSON.stringify(lispStr(r)) === JSON.stringify(want));
};

// keys
ok('keys dict (lispStr)', lispStr(run("(keys (dict (quote a) 1 (quote b) 2))")) === '(a b)');
ok('keys 列表返回索引', lispStr(run("(keys (list 10 20 30))")) === '(0 1 2)');
ok('keys 字符串返回索引', lispStr(run('(keys "ab")')) === '(0 1)');
ok('keys set 返回元素', lispStr(run('(keys (set 1 2))')) === '(1 2)');

// vals
ok('vals dict', lispStr(run("(vals (dict (quote a) 1 (quote b) 2))")) === '(1 2)');
ok('vals 列表返回自身', lispStr(run('(vals (list 10 20 30))')) === '(10 20 30)');
ok('vals 字符串返回字符', lispStr(run('(vals "ab")')) === '("a" "b")');

// count
ok('count 列表', run('(count (list 1 2 3))') === 3);
ok('count 字符串', run('(count "hello")') === 5);
ok('count dict', run('(count (dict (quote a) 1 (quote b) 2))') === 2);
ok('count set', run('(count (set 1 2 3))') === 3);
ok('count 空列表 => 0', run('(count (list))') === 0);
ok('count 空表(nil) => 0', run('(count (quote ()))') === 0);
ok('count 原子 => 1', run('(count 42)') === 1);

// dissoc
ok('dissoc 移除键 b 仍在', run('(dict-get (dissoc (dict (quote a) 1 (quote b) 2) (quote a)) (quote b))') === 2);
ok('dissoc 移除键 a 消失', run('(dict-get (dissoc (dict (quote a) 1 (quote b) 2) (quote a)) (quote a))') === null);
ok('dissoc 多键', run('(dict-get (dissoc (dict (quote a) 1 (quote b) 2 (quote c) 3) (quote a) (quote c)) (quote b))') === 2);
ok('dissoc 原容器不变', run('(dict-has? (dict (quote a) 1 (quote b) 2) (quote a))') === true);
ok('dissoc set 移除元素', run('(contains? (dissoc (set 1 2 3) 2) 2)') === false);

// str
ok('str 拼接', run('(str "a" 1 (list 2 3))') === 'a123');
ok('str 空', run('(str)') === '');
ok('str nil 视为空', run('(str "x" (quote ()) "y")') === 'xy');
ok('str 布尔', run('(str #t " " #f)') === 'true false');
ok('str dict', run('(str (dict (quote a) 1))') === '{a 1}');
ok('str set', run('(str (set 1 2))') === '#{1 2}');

console.log(`containers: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
