// ci422 — Sibilant 自省工具批：doc / apropos
// 隐性修复：nth 文档示例与行为不一致（示例写 () 但返回 null）-> 统一为 null。
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
global.require = require;
new Function(code)();

const S = global.window.Sibilant;
if (!S || typeof S.run !== 'function') {
  console.error('FAIL: Sibilant runtime not attached to window');
  process.exit(1);
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${g}, want ${w}`); }
}
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error(`FAIL ${name}`); } }
function run(src) { return S.run(src); }

// R1：doc 读取 DOCS 注册表（传入引号符号或字符串名，避免被当作特殊形式求值）
ok('doc-builtin-returns-string', typeof run('(doc \'range)') === 'string');
ok('doc-macro-returns-string', typeof run('(doc \'->)') === 'string');
// defn 带文档串时也应可查
run('(defn sq "平方" (x) (* x x))');
ok('doc-userfn-returns-string', typeof run('(doc \'sq)') === 'string');
// 未定义符号返回 null
eq('doc-unknown-returns-null', run('(doc "this-symbol-does-not-exist-xyz")'), null);

// apropos 子串搜索（foldl/foldr/foldl1/foldr1 均含 fold）
ok('apropos-fold-has-foldl', run('(apropos "fold")').includes('foldl'));
ok('apropos-fold-has-foldr', run('(apropos "fold")').includes('foldr'));
ok('apropos-map-nonempty', run('(apropos "map")').length > 0);
eq('apropos-nomatch', run('(apropos "zzz_no_such")'), []);

// R2：nth 越界返回 null（与文档一致）
eq('nth-oob-null', run('(nth (list 1 2 3) 9)'), null);
eq('nth-neg-null', run('(nth (list 1 2 3) -1)'), null);
eq('nth-valid', run('(nth (list 1 2 3) 0)'), 1);

console.log(`\nci422 doc/apropos: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
