// Sibilant 模块系统测试（注入语义）：require 将导出符号注入调用方 env；
// 外部源 = registerModule 注册表 / setModuleLoader 加载器（优先）；缓存幂等 / 循环依赖 / 错误标注。
// 房屋风格：global.window 桥接加载 interpreter.js，run() 求值断言。
// 注意：modules 表全局共享，各节使用互不重复的模块名避免缓存串扰；用完 loader 须置回 null。
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=> c ? pass++ : (fail++, console.log('  FAIL', n));

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const S = global.window.Sibilant;
const { run, newEnv, lispStr } = S;

function errOf(fn){ try { fn(); return null; } catch(e){ return e.message || String(e); } }

// ---- ① registerModule + require 基础闭环（注入 env 语义，双形态模块名）----
let env = newEnv();
S.registerModule('mathx', `
  (define (clamp x lo hi) (min (max x lo) hi))
  (define (sq x) (* x x))
  (define magic 42)
  (provide clamp sq magic)`);
const r1 = run('(require "mathx")', env);
ok('require 返回模块名符号', r1 instanceof S.Sym && r1.name === 'mathx');
ok('require 后导出可直接调用', run('(clamp 9 0 5)', env) === 5);
ok('导出值注入可见', run('magic', env) === 42);
ok('导出函数注入可调用', run('(sq 7)', env) === 49);
ok('require 亦接受符号名', run('(require mathx)', env) instanceof S.Sym);
ok('重复 require 幂等', run('(+ (clamp 9 0 5) magic)', env) === 47);

// ---- ② 挑选导入：require 仅注入指定符号 ----
env = newEnv();
S.registerModule('pair', '(define a 1)\n(define b 2)\n(provide a b)');
run('(require "pair" "b")', env);
ok('挑选导入命中', run('b', env) === 2);
ok('未挑选符号不注入', (errOf(()=> run('a', env)) || '').indexOf('未定义符号') >= 0);
const pickErr = errOf(()=> run('(require "pair" "zz")', env));
ok('挑选未导出符号报错', pickErr && pickErr.indexOf('未导出') >= 0);

// ---- ③ 隔离性：未 provide 的名字不泄漏 ----
env = newEnv();
S.registerModule('secret', '(define hidden 999)\n(define shown 1)\n(provide shown)');
run('(require "secret")', env);
const leak = errOf(()=> run('hidden', env));
ok('模块内 define 未导出不可见', leak && leak.indexOf('未定义符号') >= 0);
ok('导出名可见', run('shown', env) === 1);

// ---- ④ 缓存幂等：模块只执行一次 ----
env = newEnv();
let loaderCalls = 0;
S.setModuleLoader(name => { loaderCalls++; return '(define tag ' + loaderCalls + ')\n(provide tag)'; });
run('(require "once")', env);
ok('首次加载 tag=1', run('tag', env) === 1);
run('(require "once")', env);
ok('二次 require 不重执行', loaderCalls === 1 && run('tag', env) === 1);

// ---- ⑤ loader 优先于 registry ----
env = newEnv();
S.registerModule('dual', '(define src "registry")\n(provide src)');
S.setModuleLoader(name => '(define src "loader")\n(provide src)');
ok('loader 优先于 registry', run('(require "dual")\nsrc', env) === 'loader');
S.setModuleLoader(null);

// ---- ⑥ 链式 require（模块依赖模块，经根环境可见依赖导出）----
// 注：探针用 bump1 而非 inc——inc 是 stdlib 内置（def('inc', …)），会经根环境可见导致误判。
env = newEnv();
S.registerModule('base', '(define (bump1 x) (+ x 1))\n(provide bump1)');
S.registerModule('upper', '(require "base")\n(define (add3 x) (bump1 (bump1 (bump1 x))))\n(provide add3)');
ok('链式 require（依赖导出可用）', run('(require "upper")\n(add3 4)', env) === 7);
ok('依赖符号不穿透导出', (errOf(()=> run('bump1', env)) || '').indexOf('未定义符号') >= 0);

// ---- ⑦ 循环依赖报错 ----
env = newEnv();
S.registerModule('cyc-a', '(require "cyc-b")\n(provide x)');
S.registerModule('cyc-b', '(require "cyc-a")\n(provide y)');
const cyc = errOf(()=> run('(require "cyc-a")', env));
ok('循环依赖报错', cyc && cyc.indexOf('循环依赖') >= 0);

// ---- ⑧ 找不到模块（与 smoke 锚定的既有报错词一致）----
env = newEnv();
const miss = errOf(()=> run('(require "nope")', env));
ok('找不到模块报「未定义模块」', miss && miss.indexOf('未定义模块') >= 0);

// ---- ⑨ provide 非符号参数报错 ----
env = newEnv();
S.registerModule('badp', '(provide 1 2)');
const perr = errOf(()=> run('(require "badp")', env));
ok('provide 非符号报错', perr && perr.indexOf('provide') >= 0);

// ---- ⑩ 模块顶层报错就地标注 [模块: 名] + 模块源码行片段 ----
env = newEnv();
S.registerModule('broken', '(define x undefined-sym)\n(provide x)');
const berr = errOf(()=> run('(require "broken")', env));
ok('模块顶层错误标注模块名', berr && berr.indexOf('[模块: broken]') >= 0 && berr.indexOf('未定义符号') >= 0);
ok('错误片段来自模块源码', berr && berr.indexOf('(define x undefined-sym)') >= 0);

// ---- ⑪ 模块可见 builtins/stdlib（根环境透传）----
env = newEnv();
S.registerModule('stduse', '(define (sum-sq xs) (foldl (lambda (a x) (+ a (* x x))) 0 xs))\n(provide sum-sq)');
ok('模块内可用 stdlib（foldl）', run('(require "stduse")\n(sum-sq (list 1 2 3))', env) === 14);

// ---- ⑫ clearModuleCache 后可重新加载（v=1 → clear → v=2）----
env = newEnv();
let ver = 0;
S.setModuleLoader(()=> { ver++; return '(define v ' + ver + ')\n(provide v)'; });
run('(require "reload")', env);
ok('首次加载 v=1', run('v', env) === 1);
S.clearModuleCache();
run('(require "reload")', env);
ok('clearModuleCache 后重新执行（v=2）', run('v', env) === 2 && ver === 2);
S.setModuleLoader(null);

// ---- ⑬ defmodule 与外部模块共存；clearModuleCache 不清 defmodule ----
env = newEnv();
let dcalls = 0;
S.setModuleLoader(n => { dcalls++; return '(define d ' + dcalls + ')\n(provide d)'; });
run('(defmodule inline (export k) (define k 5))', env);
run('(require inline)', env);          // defmodule 走符号形态（既有语义）
run('(require "dmod")', env);          // 外部源走字符串形态
ok('defmodule + 外部模块共存', run('(+ k d)', env) === 6);
S.clearModuleCache();
run('(require inline)', env);
ok('clearModuleCache 后 defmodule 仍可用', run('k', env) === 5);
run('(require "dmod")', env);
ok('clearModuleCache 后外部模块重载', run('d', env) === 2 && dcalls === 2);
S.setModuleLoader(null);

// ---- ⑭ 缓存共享同一模块环境（set! 状态延续）----
env = newEnv();
S.registerModule('counter', `
  (define n 0)
  (define (bump) (set! n (+ n 1)) n)
  (provide bump)`);
run('(require "counter")', env);
run('(bump)', env);
run('(bump)', env);
ok('模块内 set! 状态延续', run('(bump)', env) === 3);

// ---- ⑮ 空模块 / 无 provide 模块 → 0 符号注入 ----
env = newEnv();
S.registerModule('empty', ';; 只有注释');
S.registerModule('noexp', '(define x 1)');
ok('空模块 require 成功', errOf(()=> run('(require "empty")', env)) === null);
ok('无 provide 模块 0 符号注入', errOf(()=> run('(require "noexp")', env)) === null
  && (errOf(()=> run('x', env)) || '').indexOf('未定义符号') >= 0);

// ---- ⑯ 静态接线守卫 ----
const isrc = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
const hsrc = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok('Sibilant 暴露 registerModule/setModuleLoader/clearModuleCache',
  isrc.includes('registerModule') && isrc.includes('setModuleLoader') && isrc.includes('clearModuleCache'));
ok('require 融合外部源加载（loadExternalModule 委托）',
  isrc.includes('function loadExternalModule') && isrc.includes('loadExternalModule(mname, env, node)'));
ok('循环依赖 / 错误标注逻辑在位', isrc.includes('循环依赖: ') && isrc.includes("'[模块: '"));
ok('ev 已接 require/provide 分支', isrc.includes("case 'require':") && isrc.includes("case 'provide':"));
ok('REPL 自动扫描注册内嵌模块',
  hsrc.includes('script[type="text/x-sibilant"][data-module]') && hsrc.includes('Sibilant.registerModule'));
ok('index.html 内嵌示例模块 mathx + 演示入口',
  hsrc.includes('data-module="mathx"') && hsrc.includes('模块 · require 导入'));

console.log(`[Sibilant module] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
