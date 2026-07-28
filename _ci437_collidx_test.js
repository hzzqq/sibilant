// ci437 — Sibilant Dict/集合 索引与查取增强（R1 全新：index-by / deep-merge / get-or / find）
// R2(隐性)：此前 Dict 读取只能 dict-get，缺“缺失即默认值”的安全取值；也无按函数建索引、深度合并、首个匹配查找。
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
// 直接在表达式内读取 Dict，避免 JSON 序列化 Dict(内部 Map) 不可往返
const dg = (expr, k)=> run('(dict-get ' + expr + ' ' + JSON.stringify(k) + ')');
const dkeys = (expr)=> run('(keys ' + expr + ')');

// 1) index-by：按 mod 3 建索引，后者覆盖
const ibExpr = '(index-by (lambda (x)(mod x 3)) (list 1 2 3 4))';
ok('index-by key1->4', dg(ibExpr, 1) === 4);
ok('index-by key2->2', dg(ibExpr, 2) === 2);
ok('index-by key0->3', dg(ibExpr, 0) === 3);
ok('index-by keys', JSON.stringify(dkeys(ibExpr).slice().sort()) === '[0,1,2]');

// 2) deep-merge：嵌套 Dict 递归合并
const dmExpr = '(deep-merge (dict "a" (dict "x" 1) "b" 2) (dict "a" (dict "y" 3) "c" 4))';
ok('deep-merge nested x', dg('(dict-get ' + dmExpr + ' "a")', 'x') === 1);
ok('deep-merge nested y', dg('(dict-get ' + dmExpr + ' "a")', 'y') === 3);
ok('deep-merge b kept', dg(dmExpr, 'b') === 2);
ok('deep-merge c added', dg(dmExpr, 'c') === 4);
// 非 Dict 值被覆盖
ok('deep-merge overwrite scalar', dg('(deep-merge (dict "a" 1) (dict "a" 2))', 'a') === 2);

// 3) get-or：缺失返回默认；存在返回值
ok('get-or missing', run('(get-or (dict "a" 1) "b" 99)') === 99);
ok('get-or present', run('(get-or (dict "a" 1) "a" 99)') === 1);
ok('get-or array present', run('(get-or (list 10 20 30) 1 0)') === 20);
ok('get-or array oob', run('(get-or (list 10 20) 9 0)') === 0);
ok('get-or dict-from-json', run('(get-or (json-decode "{\\"k\\":7}") "k" 0)') === 7);
ok('get-or dict-from-json missing', run('(get-or (json-decode "{\\"k\\":7}") "z" 0)') === 0);

// 4) find-first：首个匹配（列表与 Dict 通用）
ok('find-first match', run('(find-first (lambda (x)(> x 2)) (list 1 2 3 4))') === 3);
ok('find-first none', run('(find-first (lambda (x)(> x 9)) (list 1 2 3))') === null);
ok('find-first in dict vals', run('(find-first (lambda (x)(> x 2)) (dict "p" 1 "q" 5))') === 5);

console.log(`\nci437 collidx: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
