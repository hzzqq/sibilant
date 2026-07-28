// ci411 — Sibilant 并发/异步批：async / await / delay / promise-all / go（基于原生 Promise）
// 隐性修复：给未登记文档的内置 eval 补 doc 字符串。
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

(async () => {
  try {
    // ---------- 同步语义不被破坏 ----------
    eq('同步 + 仍正常', run('(+ 1 2 3)'), 6);
    ok('rand-int 同步仍可用', Number.isInteger(run('(rand-int 10)')));

    // ---------- sleep（JS Promise 版 delay，避免与惰性原语 delay 冲突）----------
    eq('sleep 解析为 val', await run('(sleep 5 42)'), 42);
    ok('sleep 返回 Promise', run('(sleep 1 1)') instanceof Promise);

    // ---------- async ----------
    eq('async 包装 thunk', await run('(async (lambda () (+ 1 2)))'), 3);
    eq('async 非函数值直接 resolve', await run('(async 7)'), 7);

    // ---------- await-promise（避免与惰性原语 await 冲突）----------
    eq('await-promise 解包 sleep', await run('(await-promise (sleep 10 "x"))'), 'x');
    eq('await-promise 非 thenable 包成已决议', await run('(await-promise 5)'), 5);

    // ---------- promise-all ----------
    eq('promise-all 聚合', await run('(promise-all (list (sleep 5 1) (sleep 5 2) (sleep 5 3)))'), [1,2,3]);
    eq('promise-all 空 -> ()', await run('(promise-all (list))'), []);

    // ---------- go ----------
    eq('go 并发派发', await run('(go (lambda () (* 3 4)))'), 12);
    eq('go 并发收集', await run('(promise-all (list (go (lambda () 1)) (go (lambda () 2))))'), [1,2]);

    // ---------- 文档存在性 ----------
    ['async','await-promise','sleep','promise-all','go'].forEach(n => ok('doc '+n+' 存在', typeof run('(doc "'+n+'")') === 'string'));

    // ---------- 隐性修复验证：eval 文档 ----------
    ok('eval 文档已补登', typeof run('(doc "eval")') === 'string');
    ok('eval 行为仍正确', run('(eval "(+ 2 3)")') === 5);

    console.log(`ci411(async): pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('ASYNC TEST ERROR:', e);
    process.exit(1);
  }
})();
