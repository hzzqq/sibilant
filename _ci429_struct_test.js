// ci429 — Sibilant 结构化数据增强：defstruct 不可变更新 + 自省工具
// R1：新增 struct-set / struct-get / struct-fields / struct-name / struct->dict / struct=?
// R2(隐性修复)：defstruct 构造器此前不做参数个数校验，少传字段静默留 undefined；
//     现强制 arity 校验，参数个数不符即抛出明确错误（边界/错误处理完备）。
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

// 单次程序内定义并使用，返回可比较原语列表（this Lisp 的序贯体是 begin 而非 do）
const r = run(`(begin
  (defstruct point x y)
  (list
    (point-x (point 1 2))                       ; 1
    (point-y (point 1 2))                       ; 2
    (point? (point 1 2))                        ; true
    (struct-name (point 3 4))                   ; "point"
    (equal? (struct-fields (point 3 4)) (list 'x 'y)) ; true
    (struct-get (point 3 4) 'x)                 ; 3
    (struct=? (point 3 4) (point 3 4))          ; true
    (struct=? (point 3 4) (point 3 5))          ; false
    (struct? (point 3 4))                        ; true
    (struct? 5)                                  ; false
    (let ((p (point 3 4)))
      (let ((p2 (struct-set p 'x 9)))
        (list (point-x p2) (point-x p))))        ; [9, 3] 原实例不变
  )
)`);

ok('point-x = 1', r[0] === 1);
ok('point-y = 2', r[1] === 2);
ok('point? true', r[2] === true);
ok('struct-name = "point"', r[3] === 'point');
ok('struct-fields = (x y)', r[4] === true);
ok('struct-get x = 3', r[5] === 3);
ok('struct=? 同值 true', r[6] === true);
ok('struct=? 异值 false', r[7] === false);
ok('struct? 实例 true', r[8] === true);
ok('struct? 非实例 false', r[9] === false);
ok('struct-set 不可变：新=9 原=3', r[10][0] === 9 && r[10][1] === 3);

// struct->dict 返回真正的 dict 对象（含 store）
const d = run('(begin (defstruct point x y) (struct->dict (point 7 8)))');
ok('struct->dict 返回 dict 对象', d && typeof d === 'object' && 'store' in d);

// R2：arity 校验——少传字段必须抛错（隐性修复验证）
let threw = false, msg = '';
try { run('(begin (defstruct point x y) (point 1))'); }
catch(e){ threw = true; msg = e.message || ''; }
ok('ctor 参数不足抛错(R2)', threw && /需要 2 个参数/.test(msg));

// 多传字段同样应被拒绝
let threw2 = false;
try { run('(begin (defstruct point x y) (point 1 2 3))'); }
catch(e){ threw2 = true; }
ok('ctor 参数过多抛错', threw2);

// 非 struct 调用 struct-get 抛错（边界）
let threw3 = false;
try { run('(begin (defstruct point x y) (struct-get 5 \'x))'); }
catch(e){ threw3 = true; }
ok('struct-get 非实例抛错', threw3);

console.log(`\nci429 struct update+introspection: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
