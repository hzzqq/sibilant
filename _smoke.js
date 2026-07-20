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

console.log(`\n[Sibilant smoke] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
