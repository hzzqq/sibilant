// ci459 回归：JSON 往返后 Dict 值不得丢失（此前 dict-get 返回 null，因 lispStr 对字符串加引号
// 导致 JSON 反序列化的字符串键与符号键不匹配）。同时验证 keyOf 统一符号/字符串键。
const fs = require('fs');
const path = require('path');
global.window = {};
global.require = require;
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const S = global.window.Sibilant;
const run = (s) => S.run(s);

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.error('FAIL ' + n); } };
const eq = (n, g, w) => {
  const gs = JSON.stringify(g), ws = JSON.stringify(w);
  if (gs === ws) pass++;
  else { fail++; console.error(`FAIL ${n}: got ${gs} want ${ws}`); }
};

// ---- JSON 往返：dict 值不再丢失（ci459 修复点）----
eq('roundtrip scalar', run('(dict-get (json-parse (json-stringify (dict (quote a) 1))) (quote a))'), 1);
eq('roundtrip nested list', run('(dict-get (json-parse (json-stringify (dict (quote a) 1 (quote b) (list 2 3)))) (quote b))'), [2, 3]);
eq('roundtrip string-key lookup', run('(dict-get (json-parse (json-stringify (dict (quote a) 1))) "a")'), 1);
eq('roundtrip list', run('(json-parse (json-stringify (list 1 2 3)))'), [1, 2, 3]);
eq('roundtrip nested dict value', run('(dict-get (dict-get (json-parse (json-stringify (dict (quote x) (dict (quote y) 7)))) (quote x)) (quote y))'), 7);

// ---- keyOf 统一符号/字符串键（直接构建亦可互查）----
eq('str-built sym-lookup', run('(dict-get (dict "a" 1) (quote a))'), 1);
eq('sym-built str-lookup', run('(dict-get (dict (quote a) 1) "a")'), 1);

// ---- set 符号/字符串元素统一 ----
ok('set sym/str unify', run('(set-has? (set (quote a) "a") "a")') === true && run('(set-has? (set (quote a) "a") (quote a))') === true);

// ---- 常规 dict 用法不受影响（符号键依旧可用）----
eq('plain symbol key', run('(dict-get (dict (quote k) 42) (quote k))'), 42);

console.log(`\nci459 json-roundtrip: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
