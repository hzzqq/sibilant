// ci434 — Sibilant map 多集合并行修复 + partition-all 新增
// R1：新增 partition-all（此前缺失；map-indexed/distinct-by 已于前文存在，不重复定义）
// R2(隐性 bug 修复)：map 此前仅映射第一个集合、静默忽略其余参数 (map + (list 1 2) (list 3 4)) => (1 2)；
//     现支持多集合并行映射，按最短截断，单集合行为向后兼容。
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

// 1) map 多集合并行（R2 修复验证）
ok('map 多集合并行', JSON.stringify(run('(map + (list 1 2) (list 3 4))')) === '[4,6]');
ok('map 三集合', JSON.stringify(run('(map + (list 1 2) (list 10 20) (list 100 200))')) === '[111,222]');
ok('map 单集合向后兼容', JSON.stringify(run('(map (lambda (x) (* x 2)) (list 1 2 3))')) === '[2,4,6]');
ok('map 按最短截断', JSON.stringify(run('(map + (list 1 2 3) (list 10 20))')) === '[11,22]');
ok('map 无集合返回空', JSON.stringify(run('(map +)')) === '[]');

// 2) partition-all（R1 新增）
ok('partition-all 整除', JSON.stringify(run('(partition-all 2 (list 1 2 3 4))')) === '[[1,2],[3,4]]');
ok('partition-all 末段不足', JSON.stringify(run('(partition-all 2 (list 1 2 3 4 5))')) === '[[1,2],[3,4],[5]]');

console.log(`\nci434 map+partition-all: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
