// Sibilant 堆（最小优先队列）单元测试：经 run() 直跑 LISP 表达式断言 heap 原语族
// （heap-new/push/pop/peek/size/empty?/to-list）的排序正确性、不可变语义、
// 自定义比较器（含 Sibilant lambda）、空堆报错与 lispStr 显示；另跑 heap-drain 手写循环验证组合可用性。
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c)=> { if(c) pass++; else { fail++; console.log('  FAIL:', n); } };
const eq = (n, expr, want)=> {
  let r; try { r = lispStr(run(expr)); } catch(e){ fail++; console.log('  FAIL', n, '->', e.message); return; }
  ok(n + '  => ' + r, r === want);
};
const throws = (n, expr, msgPart)=> {
  try { run(expr); fail++; console.log('  FAIL', n, '-> 未抛错'); }
  catch(e){ ok(n, String(e.message).includes(msgPart)); }
};

// ---- 1) 构造与排序 ----
eq('heap-to-list 升序弹出', '(heap-to-list (heap-new 3 1 2))', '(1 2 3)');
eq('heap-new 空堆', '(heap-size (heap-new))', '0');
eq('heap-new 单元素', '(heap-to-list (heap-new 5))', '(5)');
{
  // 乱序 20 元素全排序正确（固定排列，确定性）
  const xs = [17, 3, 9, 25, 1, 14, 8, 22, 5, 30, 2, 19, 11, 7, 28, 4, 16, 10, 21, 6];
  const r = run('(heap-to-list (heap-new ' + xs.join(' ') + '))');
  ok('20 元素乱序全排序', JSON.stringify(r) === JSON.stringify(xs.slice().sort((a,b)=>a-b)));
}
eq('heap-peek 恒最小', '(heap-peek (heap-new 5 2 8 1 9))', '1');

// ---- 2) 不可变语义 ----
eq('push 后原堆 size 不变', "(define h0 (heap-new 1 2)) (heap-push h0 0) (heap-size h0)", '2');
eq('push 后新堆含新元素', "(define h0 (heap-new 1 2)) (heap-peek (heap-push h0 0))", '0');
eq('pop 后原堆保留', "(define h1 (heap-new 3 1 2)) (define h2 (heap-pop h1)) (heap-peek h1)", '1');
eq('pop 后新堆 size-1', "(define h1 (heap-new 3 1 2)) (heap-size (heap-pop h1))", '2');
eq('peek/pop 组合 drain（手写循环）', "(define h (heap-new 5 1 4 2 3)) (define drain (lambda (h acc) (if (heap-empty? h) acc (drain (heap-pop h) (append acc (list (heap-peek h))))))) (drain h (list))", '(1 2 3 4 5)');

// ---- 3) 自定义比较器（Sibilant lambda → 最大堆） ----
eq('倒序比较器 → 最大堆', '(heap-to-list (heap-new 1 5 3 (lambda (a b) (- b a))))', '(5 3 1)');
eq('最大堆 peek', '(heap-peek (heap-new 1 5 3 (lambda (a b) (- b a))))', '5');
eq('比较器随堆传递（pop 后仍倒序）', "(define hm (heap-new 1 5 3 (lambda (a b) (- b a)))) (heap-peek (heap-pop hm))", '3');

// ---- 4) 字符串堆 ----
eq('字符串堆字典序', '(heap-to-list (heap-new "pear" "apple" "fig"))', '("apple" "fig" "pear")');

// ---- 5) 空堆与报错 ----
eq('heap-empty? 空堆', '(heap-empty? (heap-new))', '#t');
eq('heap-empty? 非空', '(heap-empty? (heap-new 1))', '#f');
throws('空堆 peek 报错', '(heap-peek (heap-new))', 'heap-peek 空堆');
throws('空堆 pop 报错', '(heap-pop (heap-new))', 'heap-pop 空堆');
throws('heap-push 非 heap 报错', "(heap-push (list 1) 2)", 'heap-push 需要 heap');
throws('heap-to-list 非 heap 报错', '(heap-to-list 5)', 'heap-to-list 需要 heap');

// ---- 6) lispStr / str 显示 ----
eq('lispStr #heap[] 显示（内部数组序）', '(lispStr (heap-new 2 1))', '"#heap[1 2]"');
eq('str 内嵌 heap', '(str (heap-new 2 1))', '"#heap[1 2]"');

// ---- 7) 宽容原语 ----
{
  let r; try { r = run('(heap-size 5)'); ok('heap-size 非 heap 返回 0（不抛）', r === 0); } catch(e){ ok('heap-size 非 heap 返回 0（不抛）', false); }
  let e2; try { e2 = run('(heap-empty? 5)'); ok('heap-empty? 非 heap 返回 true（宽容）', e2 === true); } catch(err){ ok('heap-empty? 非 heap 返回 true（宽容）', false); }
}

console.log('heap: ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
