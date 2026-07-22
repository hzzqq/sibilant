// ci227 — Sibilant 随机辅助：rand-nth / shuffle / repeatedly
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL:', n); } };

// rand-nth：结果必是集合成员之一；空集合返回 null
{
  let allMember = true;
  for(let i = 0; i < 30; i++){
    const v = run('(rand-nth (list 1 2 3))');
    if(![1,2,3].includes(v)) allMember = false;
  }
  ok('rand-nth 30 次均落在 (1 2 3) 中', allMember);
  // 单元素必返回该元素
  ok('rand-nth 单元素', run('(rand-nth (list 42))') === 42);
  // 空列表返回 null
  ok('rand-nth 空列表 => null', run('(rand-nth (list))') === null);
  // 字符串? 仅 list/set/dict 支持，其它返回 null（用数字验证非集合返回 null 不易，跳过）
}

// shuffle：长度/多重集不变，返回新列表
{
  const r = run('(shuffle (list 1 2 3 4 5))');
  ok('shuffle 长度不变', Array.isArray(r) && r.length === 5);
  ok('shuffle 多重集不变(排序后相等)', JSON.stringify(r.slice().sort((a,b)=>a-b)) === JSON.stringify([1,2,3,4,5]));
  // 多次随机也应保持多重集
  let multisetOk = true;
  for(let i = 0; i < 20; i++){
    const s = run('(shuffle (list 1 2 3))').slice().sort((a,b)=>a-b);
    if(JSON.stringify(s) !== JSON.stringify([1,2,3])) multisetOk = false;
  }
  ok('shuffle 20 次多重集均不变', multisetOk);
  // 空列表洗牌 => ()
  ok('shuffle 空列表 => ()', lispStr(run('(shuffle (list))')) === '()');
  // 不改原集合（原集合值不变）
  ok('shuffle 不改原集合', lispStr(run('(let ((c (list 9 8 7))) (shuffle c) c)')) === '(9 8 7)');
}

// repeatedly：确定性 f
ok('repeatedly 固定值', lispStr(run('(repeatedly 4 (lambda [] 7))')) === '(7 7 7 7)');
ok('repeatedly 0 => ()', lispStr(run('(repeatedly 0 (lambda [] 7))')) === '()');
ok('repeatedly 用 atom 计数', lispStr(run('(let ((a (atom 0))) (repeatedly 3 (lambda [] (swap! a inc))))')) === '(1 2 3)');
ok('repeatedly 长度正确', run('(repeatedly 5 (lambda [] (rand-int 1000)))').length === 5);

console.log(`rand: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
