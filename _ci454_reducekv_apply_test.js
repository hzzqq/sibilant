// ci454 — Sibilant：reduce-kv(dict 键值归约) + apply 支持前置参数(隐性修复)
// R1：reduce-kv 对 dict 逐对 (累加值 键 值) 累积
// R2(隐性修复)：apply 此前仅接受 (apply f (list ...))，标准 Lisp 的 (apply f a b (list c d)) 会抛错；现支持前置参数
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

// ---- R1：reduce-kv ----
ok('reduce-kv 基本(求和值)', run('(reduce-kv (lambda (a k v) (+ a v)) 0 (dict (quote x) 1 (quote y) 2))') === 3);
ok('reduce-kv 空 dict 返回 init', run('(reduce-kv + 99 (dict))') === 99);
ok('reduce-kv 非 dict 返回 init(不崩)', run('(reduce-kv + 0 5)') === 0);
const _kvRes = run('(reduce-kv (lambda (a k v) (cons (list k v) a)) (list) (dict (quote a) 1 (quote b) 2))');
const _kvExp = run('(list (list (quote b) 2) (list (quote a) 1))');
ok('reduce-kv 累加器可见键', JSON.stringify(_kvRes) === JSON.stringify(_kvExp));
ok('reduce-kv 字符串拼接值', run('(reduce-kv (lambda (a k v) (str a v)) "" (dict (quote x) "A" (quote y) "B"))') === 'AB');

// ---- R2：apply 支持前置参数 ----
ok('apply 前置参数 (apply + 1 2 (list 3 4)) => 10', run('(apply + 1 2 (list 3 4))') === 10);
ok('apply 仅末参为列表(向后兼容)', run('(apply + (list 1 2 3))') === 6);
ok('apply 单个前置 + 列表', run('(apply * 10 (list 2 3))') === 60);
let threw = false; try { run('(apply + 5)'); } catch(e){ threw = true; }   // 末参非列表
ok('apply 末参非列表报错', threw);
let threw2 = false; try { run('(apply)'); } catch(e){ threw2 = true; }
ok('apply 无参数报错', threw2);

console.log('\n_ci454_reducekv_apply: pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
