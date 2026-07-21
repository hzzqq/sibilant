// Sibilant 冒烟测试：覆盖内置库 / 错误回溯 / 宏 / 尾递归。可被 `npm run test:lang` 调用。
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('  FAIL', name); } }
function eq(name, expr, expected){
  let r; try { r = run(expr); } catch(e){ fail++; console.log('  FAIL', name, '->', e.message); return; }
  const got = JSON.stringify(r), want = JSON.stringify(expected);
  if(got === want) pass++; else { fail++; console.log('  FAIL', name, 'got', got, 'want', want); }
}

// ---- 内置库 ----
eq('加法*', '(* 2 3 4)', 24);
eq('min', '(min 3 1 4 1 5)', 1);
eq('max', '(max 3 1 4 1 5)', 5);
eq('pow', '(pow 2 10)', 1024);
eq('round-pi', '(round pi)', 3);
eq('even?', '(even? 4)', true);
eq('odd?', '(odd? 7)', true);
eq('string-append', '(string-append "ab" "cd" 5)', 'abcd5');
eq('substring', '(substring "hello" 1 3)', 'el');

// ---- 字符串库扩容 ----
eq('string-trim', '(string-trim "  hi  ")', 'hi');
eq('string-reverse', '(string-reverse "abc")', 'cba');
ok('string-contains?', run('(string-contains? "hello world" "world")') === true);
ok('string-contains? neg', run('(string-contains? "hello" "xyz")') === false);
ok('string-split', lispStr(run('(string-split "a,b,c" ",")')) === '("a" "b" "c")');
ok('string-split ws', lispStr(run('(string-split "a  b	c")')) === '("a" "b" "c")');
ok('string-join', run('(string-join (list "a" "b" "c") "-")') === 'a-b-c');
eq('string-replace', '(string-replace "foo bar foo" "foo" "x")', 'x bar x');
eq('format ~a', '(format "x=~a" 42)', 'x=42');
eq('format ~s', '(format "n=~s" "ok")', 'n=ok');
eq('format nested', '(format "p=~a" (list 1 2))', 'p=(1 2)');
eq('format %', '(format "a~%b")', 'a\nb');
eq('list-ref', '(list-ref (list 10 20 30) 1)', 20);
eq('reverse', '(reverse (list 1 2 3))', [3,2,1]);
eq('map', '(map (lambda (x) (* x x)) (range 5))', [0,1,4,9,16]);
eq('filter', '(reduce + 0 (filter (lambda (x) (= (mod x 2) 0)) (range 10)))', 20);

// ---- 序列折叠 / 压缩 ----
eq('foldl', '(foldl + 0 (range 5))', 10);
ok('foldr', lispStr(run('(foldr cons (quote ()) (list 1 2 3))')) === '(1 2 3)');
eq('zip', '(zip (list 1 2) (list 3 4))', [[1,3],[2,4]]);
eq('zip-short', '(zip (list 1 2 3) (list 4 5))', [[1,4],[2,5]]);
ok('for-each', lispStr(run('(define xs (list)) (for-each (lambda (x) (set! xs (cons x xs))) (list 1 2 3)) xs')) === '(3 2 1)');
ok('assoc', lispStr(run('(assoc (quote b) (list (list (quote a) 1) (list (quote b) 2)))')) === '(b 2)');
ok('acons', lispStr(run('(acons (quote x) 9 (list (list (quote y) 1)))')) === '((x 9) (y 1))');

// ---- 序列工具补全 (ci70) ----
eq('range 1arg', '(range 4)', [0,1,2,3]);
eq('range 2arg', '(range 2 5)', [2,3,4]);
eq('range step', '(range 0 9 3)', [0,3,6]);
eq('range neg-step', '(range 5 0 -2)', [5,3,1]);
eq('range empty', '(range 2 2)', []);
eq('sort num', '(sort (list 3 1 2))', [1,2,3]);
ok('sort cmp', lispStr(run('(sort (list 3 1 2) (lambda (a b) (> a b)))')) === '(3 2 1)');
eq('drop', '(drop (list 1 2 3 4) 2)', [3,4]);
eq('last', '(last (list 1 2 3))', 3);
eq('last empty', '(last (list))', null);
eq('flatten', '(flatten (list 1 (list 2 (list 3 4)) 5))', [1,2,3,4,5]);
ok('any? true', run('(any? (lambda (x) (> x 3)) (list 1 2 3 4))') === true);
ok('any? false', run('(any? (lambda (x) (> x 9)) (list 1 2 3))') === false);
ok('every? true', run('(every? (lambda (x) (> x 0)) (list 1 2 3))') === true);
ok('every? false', run('(every? (lambda (x) (> x 0)) (list 1 -2 3))') === false);

// ---- 哈希表 dict (O(1) 查找) ----
ok('dict empty', run('(dict-len (dict))') === 0);
ok('dict len', run('(dict-len (dict (quote a) 1 (quote b) 2))') === 2);
ok('dict get', run('(dict-get (dict (quote a) 1 (quote b) 2) (quote a))') === 1);
ok('dict get default', run('(dict-get (dict (quote a) 1) (quote z) 99)') === 99);
ok('dict has?', run('(dict-has? (dict (quote a) 1) (quote a))') === true);
ok('dict has? neg', run('(dict-has? (dict (quote a) 1) (quote z))') === false);
ok('dict set', run('(dict-get (dict-set (dict (quote a) 1) (quote b) 2) (quote b))') === 2);
ok('dict immutable', run('(let ((d (dict (quote a) 1))) (dict-set d (quote b) 2) (dict-has? d (quote b)))') === false);
ok('dict del', run('(dict-has? (dict-del (dict (quote a) 1 (quote b) 2) (quote a)) (quote a))') === false);
ok('dict keys', lispStr(run('(dict-keys (dict (quote a) 1 (quote b) 2))')) === '(a b)');
ok('dict vals', lispStr(run('(dict-vals (dict (quote a) 1 (quote b) 2))')) === '(1 2)');
ok('dict str', lispStr(run('(dict (quote a) 1 (quote b) 2)')) === '#{a 1 b 2}');
ok('dict from pairs', run('(dict-get (dict (list (list (quote x) 10) (list (quote y) 20))) (quote y))') === 20);
// 效率对照：在大表上 dict 查找应远快于 alist（这里只验证语义正确）
ok('dict vs alist sem', run('(let ((d (dict (quote k) 7)) (a (acons (quote k) 7 (list)))) (and (= (dict-get d (quote k)) 7) (= (car (cdr (assoc (quote k) a))) 7)))') === true);

// ---- match 模式匹配 ----
ok('match-lit', lispStr(run('(match 2 (1 (quote one)) (2 (quote two)) (else (quote other)))')) === 'two');
ok('match-bind', run('(match (list 1 2 3) ((list a b c) (+ a b c)) (else 0))') === 6);
ok('match-wild', run('(match (list 9 8) ((list x _) x) (else 0))') === 9);
ok('match-cons', run('(match (list 1 2 3) ((cons h t) h) (else 0))') === 1);
ok('match-cons-tail', lispStr(run('(match (list 1 2 3) ((cons h t) t) (else (quote ())))')) === '(2 3)');
ok('match-guard', lispStr(run('(match 7 ((? even? x) (quote even)) ((? odd? x) (quote odd)) (else (quote na)))')) === 'odd');
ok('match-quote', lispStr(run('(match (quote foo) ((quote foo) (quote yes)) (else (quote no)))')) === 'yes');
ok('match-empty', run('(match (list) ((list) 42) (else 0))') === 42);

// ---- defstruct 记录类型 ----
eq('defstruct x', '(defstruct pt x y) (pt-x (pt 3 4))', 3);
eq('defstruct y', '(defstruct pt x y) (pt-y (pt 3 4))', 4);
ok('defstruct pred', run('(defstruct pt x y) (pt? (pt 1 2))') === true);
ok('defstruct pred neg', run('(defstruct pt x y) (pt? 42)') === false);
eq('defstruct nested', '(defstruct pt x y) (pt-x (pt-x (pt (pt 1 2) 9)))', 1);

// ---- loop(命名 let, TCO) / let* ----
eq('loop', '(loop sum ((n 5) (acc 0)) (if (= n 0) acc (sum (- n 1) (+ acc n))))', 15);
eq('loop-tco', '(loop f ((n 100000) (acc 0)) (if (= n 0) acc (f (- n 1) (+ acc n))))', 5000050000);
eq('let*', '(let* ((a 1) (b (+ a 1)) (c (+ a b))) (+ a b c))', 6);
eq('let* shadow', '(let* ((x 1) (x (+ x 10))) x)', 11);

// ---- letrec 互递归 + case 分发 ----
eq('letrec even/odd', '(letrec ((even? (lambda (n) (if (= n 0) #t (odd? (- n 1))))) (odd? (lambda (n) (if (= n 0) #f (even? (- n 1)))))) (even? 10))', true);
eq('letrec odd', '(letrec ((even? (lambda (n) (if (= n 0) #t (odd? (- n 1))))) (odd? (lambda (n) (if (= n 0) #f (even? (- n 1)))))) (odd? 7))', true);
ok('case 1', lispStr(run('(case 2 (1 (quote one)) (2 (quote two)) (else (quote other)))')) === 'two');
ok('case default', lispStr(run('(case 9 (1 (quote one)) (2 (quote two)) (else (quote other)))')) === 'other');
ok('case list', lispStr(run('(case 3 ((1 2 3) (quote yes)) (else (quote no)))')) === 'yes');
ok('case sym', run('(case (quote b) ((a) 1) ((b) 2) (else 0))') === 2);

// ---- 错误回溯 ----
try { run('(oops 1)'); ok('未定义符号抛错', false); }
catch(e){ ok('未定义符号带 trace', e.lisp && Array.isArray(e.trace)); }
try { run('(define (a x) (+ 0 (b x))) (define (b x) (+ 0 (c x))) (define (c x) (oops x)) (a 5)'); ok('嵌套错误', false); }
catch(e){
  const t = e.trace || [];
  ok('trace 含 c', t.includes('c'));
  ok('trace 含 a', t.includes('a'));
}
try { run('(define (a x) (b x)) (define (b x) (c x)) (define (c x) (oops x)) (a 5)'); ok('尾链抛错', false); }
catch(e){ const t = e.trace||[]; ok('尾链仅含 c（压平）', t.length===1 && t[0]==='c'); }

// ---- 宏 ----
ok('defmacro when', lispStr(run('(defmacro when (test & body) `(if ,test (begin ,@body))) (define (gt3 n) (when (> n 3) (quote yes))) (gt3 5)')) === 'yes');
ok('defmacro unless', lispStr(run('(defmacro unless (test & body) `(if (not ,test) (begin ,@body))) (define (lt3 n) (unless (> n 3) (quote no))) (lt3 1)')) === 'no');
eq('quasiquote 反引用拼接',
   '(define xs (list 2 3)) (quasiquote (1 (unquote-splicing xs) 4))',
   [1,2,3,4]);
eq('& 变参', '(define (sum-all & ns) (reduce + 0 ns)) (sum-all 1 2 3 4)', 10);

// ---- 尾递归 ----
eq('尾递归求和', '(define (sum n acc) (if (= n 0) acc (sum (- n 1) (+ acc n)))) (sum 100000 0)', 5000050000);

// ---- try / catch + error + eval ----
ok('try 捕获', lispStr(run('(try (oops 1) (catch e (quote caught)))')) === 'caught');
eq('try 绑定错误信息', '(try (error "boom") (catch e e))', 'boom');
eq('try 无异常返回值', '(try (+ 1 2) (catch e (quote no)))', 3);
eq('eval 字符串', '(eval "(+ 1 2 3)")', 6);
eq('eval AST', '(eval (quote (+ 1 2 3)))', 6);

// ---- 错误行号定位 + 源码片段 ----
try { run('(+ 1 2)\n(+ 3 4))'); ok('行号: 多余 )', false); }
catch(e){ ok('行号 多余) 落在行2', e.line === 2); }

// ---- 模块系统 defmodule / require ----
ok('defmodule+require 全部可用',
   run('(defmodule mathx (export square dbl) (define (square x) (* x x)) (define (dbl x) (* 2 x))) (require mathx) (and (= (square 5) 25) (= (dbl 3) 6))') === true);
ok('require 全部导入',
   run('(defmodule m3 (export x y) (define x 10) (define y 20)) (require m3) (+ x y)') === 30);
try { run('(defmodule m2 (export a b) (define a 1) (define b 2)) (require m2 a) b'); ok('require 仅挑部分 b 未导入', false); }
catch(e){ ok('require 仅挑部分 b 未定义', /未定义符号: b/.test(e.message)); }
try { run('(require nope) 1'); ok('require 未知模块报错', false); }
catch(e){ ok('require 未知模块抛错', /未定义模块/.test(e.message)); }
try { run('(defmodule bad (notexport a) (define a 1)) 1'); ok('defmodule 须 (export ...)', false); }
catch(e){ ok('defmodule 第二参数校验', /defmodule 第二参数须为/.test(e.message)); }

// ---- 集合 Set ----
ok('set 去重', lispStr(run('(set 1 1 2 3 3)')) === '#{1 2 3}');
ok('set 空', lispStr(run('(set)')) === '#{}');
ok('set?', run('(set? (set 1))') === true);
ok('set? neg', run('(set? (list 1))') === false);
ok('set-has?', run('(set-has? (set 1 2 3) 2)') === true);
ok('set-has? neg', run('(set-has? (set 1 2 3) 9)') === false);
ok('set-add 不可变', run('(let ((s (set 1))) (set-add s 2) (set-len s))') === 1);
ok('set-add 返回新集', run('(set-len (set-add (set 1) 2))') === 2);
ok('set-del', run('(set-len (set-del (set 1 2 3) 2))') === 2);
ok('set->list', lispStr(run('(set->list (set 1 2))')) === '(1 2)');
ok('set-union', run('(set-len (set-union (set 1 2) (set 2 3)))') === 3);
ok('set-intersect', run('(set-len (set-intersect (set 1 2 3) (set 2 3 4)))') === 2);

// ---- 报错带文件名 ----
try { run('(oops 1)', null, 'demo.sib'); ok('文件名: 不应通过', false); }
catch(e){ ok('文件名 报错信息含 [文件: demo.sib]', /\[文件: demo\.sib\]/.test(e.message)); }
try { run('(+ 1 2)\n(oops 1)', null, 'mod/f.sib'); ok('文件名+行号: 不应通过', false); }
catch(e){
  ok('文件名+行号 含 [文件: mod/f.sib]', /\[文件: mod\/f\.sib\]/.test(e.message));
  ok('文件名+行号 仍含 【行 2】', /【行 2】/.test(e.message));
}
// 不带文件名时不应污染报错信息
try { run('(oops 1)'); ok('无文件名: 不应通过', false); }
catch(e){ ok('无文件名 报错不含 [文件:', !/\[文件:/.test(e.message)); }
try { run('(+ 1 2\n(* 3 4)'); ok('行号: 缺少 )', false); }
catch(e){ ok('行号 缺少) 落在行1', e.line === 1); }
try { run('(define (f x) (+ x 1))\n(f y)'); ok('行号: 未定义符号', false); }
catch(e){ ok('行号 未定义 y 落在行2', e.line === 2); }
try { run('(dict-set 42 (quote a) 1)'); ok('行号: builtin 报错', false); }
catch(e){ ok('行号 builtin dict-set 落在行1', e.line === 1); }
try { run('(oops 1)'); ok('行号: 报错带源码片段', false); }
catch(e){ ok('行号 报错信息含【行', /【行 \d+】/.test(e.message)); ok('行号 报错信息含 > 片段', /> \(oops 1\)/.test(e.message)); }
try { run('(error "boom")'); ok('行号: error 内置带行', false); }
catch(e){ ok('行号 error 内置落在行1', e.line === 1); }

// ---- 深比较 equal? + 标准库 member?/distinct ----
ok('equal? 列表', run('(equal? (list 1 2 3) (list 1 2 3))') === true);
ok('equal? 列表 neg', run('(equal? (list 1 2) (list 1 2 3))') === false);
ok('equal? 嵌套', run('(equal? (list (list 1) 2) (list (list 1) 2))') === true);
ok('equal? dict', run('(equal? (dict (quote a) 1) (dict (quote a) 1))') === true);
ok('equal? dict neg', run('(equal? (dict (quote a) 1) (dict (quote a) 2))') === false);
ok('equal? set', run('(equal? (set 1 2) (set 2 1))') === true);
ok('equal? sym', run('(equal? (quote foo) (quote foo))') === true);
ok('equal? struct', run('(equal? (let () (defstruct pt x y) (pt 1 2)) (let () (defstruct pt x y) (pt 1 2)))') === true);
ok('member?', run('(member? 2 (list 1 2 3))') === true);
ok('member? neg', run('(member? 9 (list 1 2 3))') === false);
ok('member? 嵌套', run('(member? (list 1 2) (list (list 9) (list 1 2)))') === true);
eq('distinct', '(distinct (list 1 1 2 3 3))', [1,2,3]);
ok('distinct 嵌套', run('(equal? (distinct (list (list 1) (list 1) (list 2))) (list (list 1) (list 2)))') === true);

// ---- 标准库 stdlib（newEnv 自动加载）----
ok('stdlib identity', run('(identity 5)') === 5);
eq('stdlib constantly', '((constantly 7) 1 2 3)', 7);
eq('stdlib compose', '((compose (lambda (x) (* x 2)) (lambda (x) (+ x 1))) 3)', 8);
eq('stdlib flatten', '(flatten (list 1 (list 2 3) (list (list 4))))', [1,2,3,4]);
eq('stdlib partition', '(partition 2 (list 1 2 3 4 5))', [[1,2],[3,4],[5]]);
eq('stdlib take-while', '(take-while (lambda (x) (< x 3)) (list 1 2 3 4))', [1,2]);
eq('stdlib drop-while', '(drop-while (lambda (x) (< x 3)) (list 1 2 3 4))', [3,4]);
eq('stdlib sum', '(sum (list 1 2 3 4))', 10);
eq('stdlib product', '(product (list 1 2 3 4))', 24);
eq('stdlib last', '(last (list 1 2 3))', 3);
eq('stdlib butlast', '(butlast (list 1 2 3))', [1,2]);
ok('stdlib any?', run('(any? even? (list 1 3 4))') === true);
ok('stdlib any? neg', run('(any? even? (list 1 3 5))') === false);
ok('stdlib every?', run('(every? even? (list 2 4 6))') === true);
ok('stdlib every? neg', run('(every? even? (list 2 4 5))') === false);
eq('stdlib remove', '(remove even? (list 1 2 3 4))', [1,3]);
eq('stdlib zipmap', '(dict-get (zipmap (list (quote a) (quote b)) (list 1 2)) (quote a))', 1);
eq('stdlib frequencies', '(dict-get (frequencies (list (quote a) (quote a) (quote b))) (quote a))', 2);
eq('stdlib interpose', '(interpose 0 (list 1 2 3))', [1,0,2,0,3]);

// ---- 树 tree (n 叉树 LTree：value + children，不可变) ----
ok('tree?', run('(tree? (tree 1 (leaf 2) (leaf 3)))') === true);
ok('tree? neg', run('(tree? (list 1 2))') === false);
eq('leaf value', '(tree-value (leaf 5))', 5);
eq('tree-value', '(tree-value (tree 1 (leaf 2)))', 1);
ok('tree-children len', run('(length (tree-children (tree 1 (leaf 2) (leaf 3))))') === 2);
eq('tree-children values', '(map tree-value (tree-children (tree 1 (leaf 2) (leaf 3))))', [2,3]);
eq('tree-seq DFS', '(tree-seq (tree 1 (tree 2 (leaf 4)) (leaf 3)))', [1,2,4,3]);
eq('tree-map', '(tree-seq (tree-map (lambda (x) (* x 10)) (tree 1 (leaf 2) (leaf 3))))', [10,20,30]);
eq('tree-fold', '(tree-fold + 0 (tree 1 (leaf 2) (leaf 3)))', 6);
ok('tree-find', run('(tree-value (tree-find (lambda (x) (= x 3)) (tree 1 (leaf 2) (leaf 3))))') === 3);
ok('tree-find none', run('(tree-find (lambda (x) (= x 9)) (tree 1 (leaf 2)))') === null);
eq('tree-depth', '(tree-depth (tree 1 (tree 2 (leaf 4)) (leaf 3)))', 3);
eq('tree-size', '(tree-size (tree 1 (tree 2 (leaf 4)) (leaf 3)))', 4);
ok('equal? tree', run('(equal? (tree 1 (leaf 2)) (tree 1 (leaf 2)))') === true);
ok('equal? tree neg', run('(equal? (tree 1 (leaf 2)) (tree 1 (leaf 3)))') === false);
ok('lispStr tree', lispStr(run('(tree 1 (leaf 2))')) === '#tree(1 #tree(2))');

// ---- 惰性求值：delay / force / promise? ----
ok('promise?', run('(promise? (delay 1))') === true);
ok('promise? neg', run('(promise? 1)') === false);
ok('force', run('(force (delay (+ 1 2)))') === 3);
ok('force 非 promise 原样返回', run('(force 5)') === 5);
ok('delay 惰性：未 force 不求值', run('(let ((side 0)) (delay (set! side (+ side 1))) side)') === 0);
ok('delay 记忆化：只求值一次', run('(let ((c 0)) (define p (delay (begin (set! c (+ c 1)) 42))) (force p) (force p) c)') === 1);
ok('delay 返回值', run('(let ((c 0)) (define p (delay (begin (set! c (+ c 1)) 42))) (force p))') === 42);
// 惰性序列（stream）
ok('lazy-cons/take 2', lispStr(run('(lazy-take 2 (lazy-cons 1 (lazy-cons 2 (lazy-cons 3 (quote ())))))')) === '(1 2)');
ok('lazy-cons/take 全', lispStr(run('(lazy-take 5 (lazy-cons 1 (lazy-cons 2 (lazy-cons 3 (quote ())))))')) === '(1 2 3)');
ok('lazy-car', run('(lazy-car (lazy-cons 1 (quote ())))') === 1);
ok('lazy-cdr', run('(lazy-car (lazy-cdr (lazy-cons 1 (lazy-cons 2 (quote ())))))') === 2);
ok('lazy-null?', run('(lazy-null? (quote ()))') === true);
ok('lazy-null? neg', run('(lazy-null? (lazy-cons 1 (quote ())))') === false);
// 无限流：自然数（只取前 N 个，证明惰性生效）
ok('lazy 无限流 take', lispStr(run('(let () (define nat (lambda (n) (lazy-cons n (nat (+ n 1))))) (lazy-take 5 (nat 1)))')) === '(1 2 3 4 5)');

// memoize 记忆化高阶函数
ok('memoized? 真', run('(memoized? (memoize (lambda (x) x)))') === true);
ok('memoized? 否', run('(memoized? (lambda (x) x))') === false);
ok('memoize 结果正确', run('(let ((g (memoize (lambda (x) (* x 2))))) (g 21))') === 42);
ok('memoize 相同参数只缓存一次', run('(let ((g (memoize (lambda (x) (* x x))))) (g 3) (g 3) (g 4) (memo-cache-size g))') === 2);
ok('memoize 不同参数顺序视为不同键', run('(let ((g (memoize (lambda (a b) (list a b))))) (g 1 2) (g 1 2) (g 2 1) (memo-cache-size g))') === 2);
// 记忆化加速 fib（大数仍可行，证明重复子问题被缓存）—— 用 define+set! 让闭包可见自身
ok('memoize fib 大数', run('(let () (define fib 0) (set! fib (memoize (lambda (n) (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2))))))) (fib 25))') === 75025);

// ---- 数值与数学库扩容：gcd/lcm/signum/floor-div/quotient/random-int/integer? + 除零保护 ----
ok('gcd 12 18 = 6', run('(gcd 12 18)') === 6);
ok('gcd 含 0 = 绝对值', run('(gcd 0 7)') === 7 && run('(gcd 0 -9)') === 9);
ok('lcm 4 6 = 12', run('(lcm 4 6)') === 12);
ok('lcm 含 0 = 0', run('(lcm 0 5)') === 0);
ok('signum 正', run('(signum 3.5)') === 1);
ok('signum 负', run('(signum -2)') === -1);
ok('signum 零', run('(signum 0)') === 0);
ok('floor-div 7 3 = 2', run('(floor-div 7 3)') === 2);
ok('floor-div -7 3 = -3 (向负无穷)', run('(floor-div -7 3)') === -3);
ok('quotient 7 3 = 2', run('(quotient 7 3)') === 2);
ok('quotient -7 3 = -2 (向零截断)', run('(quotient -7 3)') === -2);
ok('integer? 整数', run('(integer? 7)') === true);
ok('integer? 浮点否', run('(integer? 7.5)') === false);
ok('除零被拦截 (/)', run('(try (/ 1 0) (catch e 999))') === 999);
ok('除零被拦截 (mod)', run('(try (mod 5 0) (catch e 999))') === 999);
ok('除零被拦截 (floor-div)', run('(try (floor-div 5 0) (catch e 999))') === 999);
// random-int 边界（多采样确保在 [a,b] 内）
let riOK = true; for(let i=0;i<200;i++){ const v = run('(random-int 3 8)'); if(typeof v!=='number' || v<3 || v>8) riOK = false; }
ok('random-int 3 8 落在 [3,8]', riOK);
ok('random-int 单参 [0,n)', run('(let ((v (random-int 5))) (and (>= v 0) (< v 5)))') === true);

// ---- 位运算库（32 位有符号整数语义）----
eq('bit-and', '(bit-and 12 10)', 8);          // 1100 & 1010 = 1000 = 8
eq('bit-or', '(bit-or 12 10)', 14);           // 1100 | 1010 = 1110 = 14
eq('bit-xor', '(bit-xor 12 10)', 6);         // 1100 ^ 1010 = 0110 = 6
eq('bit-not', '(bit-not 0)', -1);             // ~0 = -1
eq('bit-not 12', '(bit-not 12)', -13);       // ~1100 = ...11110011 = -13
eq('bit-shift-left', '(bit-shift-left 1 4)', 16);
eq('bit-shift-left 累加', '(bit-shift-left 3 2)', 12);
eq('bit-shift-right 算术', '(bit-shift-right 16 2)', 4);
eq('bit-shift-right 负数保号', '(bit-shift-right -16 2)', -4);
eq('bit-shift-right-logical 负数', '(bit-shift-right-logical -16 2)', 1073741820);
ok('bit-and 结果仍是整数', Number.isInteger(run('(bit-and 7 3)')));
ok('bit-xor 自反', run('(bit-xor 5 5)') === 0);

// ---- 文档字符串（help / doc / docs）----
ok('help 返回字符串', typeof run('(help (quote +))') === 'string');
ok('help 含说明文字', run('(help (quote +))').indexOf('加法') >= 0);
ok('doc 返回文档', run('(doc (quote map))') === '映射：对列表每个元素应用函数，返回新列表');
ok('doc 未登记返回 null', run('(doc (quote totally-unknown-sym-xyz))') === null);
ok('docs 返回列表含 +', Array.isArray(run('(docs)')) && run('(docs)').indexOf('+') >= 0);
ok('docs 含 help', run('(docs)').indexOf('help') >= 0);
ok('help 未登记符号给出提示', run('(help (quote totally-unknown-sym-xyz))').indexOf('没有') >= 0);

// ---- 正则表达式内置（regex-*）----
ok('regex-test 命中', run('(regex-test "an" "banana")') === true);
ok('regex-test 不命中', run('(regex-test "xyz" "banana")') === false);
eq('regex-match 首匹配+捕获组', '(regex-match "(an)" "banana")', ['an', 'an']);
ok('regex-match 不命中返回 null', run('(regex-match "zzz" "banana")') === null);
eq('regex-find-all 全匹配', '(regex-find-all "an" "banana")', ['an','an']);
eq('regex-replace 全局替换', '(regex-replace "a" "banana" "X")', 'bXnXnX');
eq('regex-split 用分隔符切分', '(regex-split "n" "banana")', ['ba','a','a']);
eq('regex-find-all 反斜杠 \\d+', '(regex-find-all "\\\\d+" "a1b22c333")', ['1','22','333']);
ok('regex-match 文档已登记', run('(docs)').indexOf('regex-match') >= 0);
ok('regex-split 文档已登记', run('(docs)').indexOf('regex-split') >= 0);

// ---- JSON 序列化（json-encode / json-decode / json?）----
eq('json-encode 列表', '(json-encode (list 1 2 3))', '[1,2,3]');
eq('json-encode #t', '(json-encode #t)', 'true');
eq('json-encode 字典', '(json-encode (dict (quote a) 1 (quote b) 2))', '{"a":1,"b":2}');
ok('json-encode 字符串带引号', run('(json-encode "hi")') === '"hi"');
ok('json-decode 列表 往返', lispStr(run('(json-decode (json-encode (list 1 2 3)))')) === '(1 2 3)');
ok('json-decode 字典取值 往返', run('(dict-get (json-decode (json-encode (dict (quote a) 1 (quote b) 2))) "b")') === 2);
ok('json 嵌套数组 往返', run('(car (car (json-decode (json-encode (list (list 9))))))') === 9);
ok('json? 合法 JSON', run('(json? (json-encode (list 1)))') === true);
ok('json? 非法 JSON', run('(json? "{bad")') === false);
ok('json-encode 文档已登记', run('(docs)').indexOf('json-encode') >= 0);

console.log(`\n[Sibilant smoke] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
