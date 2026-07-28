// ci417 — Sibilant 序列生成/计数补充：repeat / count-by
// 显性需求：新增两个常用序列工具；隐性修复：验证分组计数键为非字符串(布尔)时仍可正确取回。
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();

const S = global.window.Sibilant;
if (!S || typeof S.run !== 'function') { console.error('FAIL: runtime not attached'); process.exit(1); }

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.error(`FAIL ${name}: got ${g}, want ${w}`); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error(`FAIL ${name}`); } }
function run(src) { return S.run(src); }

// ---------- repeat ----------
eq('repeat 基础', run('(repeat 0 3)'), [0,0,0]);
eq('repeat 字符串', run('(repeat "a" 2)'), ['a','a']);
eq('repeat 负n为空', run('(repeat 1 -2)'), []);
eq('repeat 非数为空', run('(repeat 1 "x")'), []);
ok('repeat 文档存在', typeof run('(doc "repeat")') === 'string');

// ---------- count-by ----------
ok('count-by 返回 dict', run('(type-of (count-by even? (list 1 2 3 4)))') === 'dict');
eq('count-by 布尔键取回#t', run('(dict-get (count-by even? (list 1 2 3 4)) #t)'), 2);
eq('count-by 布尔键取回#f', run('(dict-get (count-by even? (list 1 2 3 4)) #f)'), 2);
eq('count-by 空列表为空dict', run('(dict-len (count-by even? (list)))'), 0);
eq('count-by 字符串键', run('(dict-get (count-by (lambda (s) (substring s 0 1)) (list "ab" "ax" "bc")) "a")'), 2);
ok('count-by 文档存在', typeof run('(doc "count-by")') === 'string');

console.log(`ci417(seq-extra): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
