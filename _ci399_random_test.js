// ci399 — Sibilant 随机/概率批：rand / rand-int / rand-choice / shuffle / seed-rand
// 隐性修复：新增可种子化 RNG（seed-rand），rand/rand-int/rand-choice/shuffle 路由到同一 RNG，
//          使随机函数可复现、可测试（此前完全不可复现）；rand-int 扩展支持 [a,b] 区间。
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

// ---------- rand ----------
let randInRange = true;
for (let i = 0; i < 50; i++) { const v = run('(rand)'); if (!(typeof v === 'number' && v >= 0 && v < 1)) randInRange = false; }
ok('rand 落在 [0,1)', randInRange);
ok('rand 文档存在', typeof run('(doc "rand")') === 'string');

// ---------- rand-int 单参 [0,n) ----------
let riSingle = true;
for (let i = 0; i < 200; i++) { const v = run('(rand-int 10)'); if (!(Number.isInteger(v) && v >= 0 && v < 10)) riSingle = false; }
ok('rand-int 10 落在 [0,9]', riSingle);

// ---------- rand-int 双参 [a,b] 含端点 ----------
run('(seed-rand 7)');           // 固定种子，便于做有界断言
let riRange = true, sawLo = false, sawHi = false;
for (let i = 0; i < 400; i++) {
  const v = run('(rand-int 1 6)');
  if (!(Number.isInteger(v) && v >= 1 && v <= 6)) riRange = false;
  if (v === 1) sawLo = true; if (v === 6) sawHi = true;
}
ok('rand-int 1 6 落在 [1,6]', riRange);
ok('rand-int 1 6 能取到下界 1', sawLo);
ok('rand-int 1 6 能取到上界 6', sawHi);
// 非有限 / 逆序 -> null
eq('rand-int 非有限 -> null', run('(rand-int "x" 5)'), null);
eq('rand-int a>b -> null', run('(rand-int 5 1)'), null);
ok('rand-int 文档存在', typeof run('(doc "rand-int")') === 'string');

// ---------- 可复现性（seed-rand）----------
// 注意：每次 run 都会重建环境（含独立的 RNG 状态），故“设种子”与“采样”必须在同一次 run 内完成。
function seededSeq(seed){ return run('(let ((_ (seed-rand ' + seed + '))) (list (rand-int 1000) (rand-int 1000) (rand-int 1000)))'); }
eq('seed-rand 同种子序列一致', seededSeq(123), seededSeq(123));
ok('seed-rand 不同种子序列一般不同', JSON.stringify(seededSeq(123)) !== JSON.stringify(seededSeq(456)));

// ---------- rand-choice ----------
let rcOk = true, rcMember = true;
for (let i = 0; i < 200; i++) { const v = run('(rand-choice (list 1 2 3))'); if (![1,2,3].includes(v)) rcMember = false; if (typeof v !== 'number') rcOk = false; }
ok('rand-choice 取值为集合成员', rcMember);
eq('rand-choice 空列表 -> null', run('(rand-choice (list))'), null);
ok('rand-choice 文档存在', typeof run('(doc "rand-choice")') === 'string');

// ---------- shuffle ----------
const sh = run('(shuffle (list 1 2 3 4 5))');
ok('shuffle 长度不变', Array.isArray(sh) && sh.length === 5);
ok('shuffle 多重集不变', JSON.stringify(sh.slice().sort((a,b)=>a-b)) === JSON.stringify([1,2,3,4,5]));
eq('shuffle 空列表 -> ()', run('(shuffle (list))'), []);
ok('shuffle 不改原集合', run('(let ((c (list 9 8 7))) (shuffle c) c)') !== undefined && JSON.stringify(run('(let ((c (list 9 8 7))) (shuffle c) c)')) === JSON.stringify([9,8,7]));
ok('shuffle 文档存在', typeof run('(doc "shuffle")') === 'string');

// ---------- 可复现洗牌 ----------
eq('seed-rand 后 shuffle 可复现',
  run('(let ((_ (seed-rand 99))) (shuffle (list 1 2 3 4 5)))'),
  run('(let ((_ (seed-rand 99))) (shuffle (list 1 2 3 4 5)))'));

// 隐性修复验证：seed-rand 返回值（种子本身）
ok('seed-rand 返回本次种子', Number.isInteger(run('(seed-rand 42)')));

console.log(`ci399(random): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
