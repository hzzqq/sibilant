// Sibilant — 一门自研 Lisp 方言的解释器
// 纯手写：词法分析 -> 递归下降解析 -> 树遍历解释器 + 词法作用域闭包
// 增强：宏系统(defmacro + quasiquote/ unquote / unquote-splicing / & 变参)
//      + 尾递归优化( trampoline TCO，尾调用不增长 JS 调用栈)

class Sym { constructor(name){ this.name = name; } }

// 哈希表（字典）：O(1) 查找的原生 Map 封装，键支持 sym/num/str（统一用 lispStr 作键）。
// 设计为不可变：dict-set / dict-del 返回新字典，原字典不变。
class Dict {
  constructor(){ this.store = new Map(); }           // lispStr(k) -> {k, v}
  _clone(){ const d = new Dict(); for(const [sk, e] of this.store) d.store.set(sk, e); return d; }
  put(k, v, mutate){
    const d = mutate ? this : this._clone();
    d.store.set(lispStr(k), { k, v });
    return d;
  }
  get(k){ const e = this.store.get(lispStr(k)); return e ? e.v : undefined; }
  has(k){ return this.store.has(lispStr(k)); }
  del(k){ const d = this._clone(); d.store.delete(lispStr(k)); return d; }
  keys(){ const r = []; for(const e of this.store.values()) r.push(e.k); return r; }
  vals(){ const r = []; for(const e of this.store.values()) r.push(e.v); return r; }
  get len(){ return this.store.size; }
}

// 集合（Set）：以 lispStr(v) 作键去重，保留原值；不可变语义（set-add/set-del 返回新集合）。
class LSet {
  constructor(){ this.m = new Map(); }
  _clone(){ const s = new LSet(); for(const [k, v] of this.m) s.m.set(k, v); return s; }
  add(v, mutate){ const s = mutate ? this : this._clone(); s.m.set(lispStr(v), v); return s; }
  has(v){ return this.m.has(lispStr(v)); }
  del(v){ const s = this._clone(); s.m.delete(lispStr(v)); return s; }
  get len(){ return this.m.size; }
  keys(){ return [...this.m.values()]; }
}

// 树（n 叉树）：每个节点含 value + children（LTree 数组）。不可变：构造即定型，
// tree-map / tree-insert 返回新树。用于层级数据、AST、目录树等。
class LTree {
  constructor(value, children){ this.value = value; this.children = children || []; }
}
function treeMap(f, t){
  if(!(t instanceof LTree)) throw lispError('tree-map 需要 tree');
  const kids = t.children.map(c => treeMap(f, c));
  return new LTree(applyFn(f, [t.value]), kids);
}
function treeFold(f, acc, t){
  if(!(t instanceof LTree)) throw lispError('tree-fold 需要 tree');
  let a = applyFn(f, [acc, t.value]);
  for(const c of t.children) a = treeFold(f, a, c);
  return a;
}
function treeSeq(t){
  if(!(t instanceof LTree)) throw lispError('tree-seq 需要 tree');
  let r = [t.value];
  for(const c of t.children) r = r.concat(treeSeq(c));
  return r;
}
function treeFind(pred, t){
  if(!(t instanceof LTree)) throw lispError('tree-find 需要 tree');
  if(applyFn(pred, [t.value])) return t;
  for(const c of t.children){ const r = treeFind(pred, c); if(r) return r; }
  return null;
}
function treeDepth(t){
  if(!(t instanceof LTree)) throw lispError('tree-depth 需要 tree');
  if(!t.children.length) return 1;
  let m = 0; for(const c of t.children) m = Math.max(m, treeDepth(c));
  return 1 + m;
}
function treeSize(t){
  if(!(t instanceof LTree)) throw lispError('tree-size 需要 tree');
  let n = 1; for(const c of t.children) n += treeSize(c);
  return n;
}

// 惰性求值：delay 产出的“承诺(promise)”——捕获表达式与环境，force 时才求值且只求值一次。
class LPromise {
  constructor(expr, env){ this.expr = expr; this.env = env; this.forced = false; this.val = undefined; }
}
// 惰性序列（stream）：头部立即求值，尾部是一个 promise（force 后给出下一个 LStream 或 null）。
class LStream {
  constructor(head, tailPromise){ this.head = head; this.tail = tailPromise; }
}
function forcePromise(p){
  if(!(p instanceof LPromise)) return p;        // force 非 promise 对象 → 原样返回
  if(p.forced) return p.val;                    // 记忆化：只求值一次
  const r = resolveTail(ev(p.expr, p.env, true));
  p.val = r; p.forced = true;
  return r;
}

// 运行时调用栈（用于错误回溯）。每次进入/离开一个过程时 push/pop 标签。
let callStack = [];
let activeFile = null;            // 当前运行文件的名字（由 run 传入，用于报错定位）
const modules = Object.create(null);  // 模块注册表：name -> { 导出符号: 值 }
function lispError(msg, loc){
  const e = new Error(msg);
  e.lisp = true;
  const ln = nodeLine(loc);
  if(ln != null) e.line = ln;        // 报错所在行号
  if(activeFile) e.file = activeFile; // 报错所在文件
  e.trace = callStack.slice();   // 快照当前调用链
  return e;
}

function tokenize(src){
  const out = []; const lines = []; const n = src.length; let i = 0; let curLine = 1;
  while(i < n){
    const c = src[i];
    if(c === ';'){ while(i < n && src[i] !== '\n') i++; continue; }
    if(c === ' ' || c === '\n' || c === '\t' || c === '\r'){
      if(c === '\n') curLine++; i++; continue;
    }
    if(c === '(' || c === ')'){ out.push(c); lines.push(curLine); i++; continue; }
    if(c === '`'){ out.push('`'); lines.push(curLine); i++; continue; }              // quasiquote
    if(c === ','){
      if(src[i+1] === '@'){ out.push(',@'); lines.push(curLine); i += 2; } else { out.push(','); lines.push(curLine); i++; }
      continue;
    }
    if(c === '"'){
      let j = i+1, s = '';
      while(j < n && src[j] !== '"'){
        if(src[j] === '\\' && j+1 < n){ s += src[j+1]; j += 2; }
        else { if(src[j] === '\n') curLine++; s += src[j]; j++; }
      }
      out.push('"' + s + '"'); lines.push(curLine); i = j+1; continue;
    }
    if(c === "'"){ out.push("'"); lines.push(curLine); i++; continue; }
    let j = i; const startLine = curLine;
    while(j < n && !'()"\'; `,@\t\r\n'.includes(src[j])){
      if(src[j] === '\n') curLine++;
      j++;
    }
    out.push(src.slice(i, j)); lines.push(startLine); i = j;
  }
  return { tokens: out, lines };
}

function atom(tok, ln){
  if(tok[0] === '"') return tok.slice(1, -1);
  if(tok === '#t') return true;
  if(tok === '#f') return false;
  if(/^-?\d+(\.\d+)?$/.test(tok)) return parseFloat(tok);
  const s = new Sym(tok); s.line = ln; return s;       // 记录 token 所在行，用于报错定位
}

// 从节点(或裸行号)取出行号：Sym 自带 .line，列表记录开括号行
function nodeLine(loc){
  if(loc == null) return null;
  if(typeof loc === 'number') return loc;
  if(loc instanceof Sym) return loc.line;
  if(Array.isArray(loc)) return loc.line != null ? loc.line : (loc[0] && loc[0].line);
  return null;
}

function parseAll(src){
  const { tokens, lines } = tokenize(src); let pos = 0;
  function lineAt(i){ return (i >= 0 && i < lines.length) ? lines[i] : null; }
  function read(){
    if(pos >= tokens.length) throw lispError('意外结束，缺少右括号');
    const t = tokens[pos++]; const ln = lineAt(pos-1);
    if(t === '('){
      const list = [];
      while(tokens[pos] !== ')'){
        if(pos >= tokens.length) throw lispError('缺少 )', ln);
        list.push(read());
      }
      pos++; list.line = ln; return list;
    }
    if(t === ')') throw lispError('多余的 )', ln);
    if(t === "'") { const r = [new Sym('quote'), read()]; r.line = ln; return r; }
    if(t === '`') { const r = [new Sym('quasiquote'), read()]; r.line = ln; return r; }
    if(t === ',') { const r = [new Sym('unquote'), read()]; r.line = ln; return r; }
    if(t === ',@') { const r = [new Sym('unquote-splicing'), read()]; r.line = ln; return r; }
    return atom(t, ln);
  }
  const exprs = [];
  while(pos < tokens.length){
    if(tokens[pos] === ')') throw lispError('多余的 )', lineAt(pos));
    exprs.push(read());
  }
  return exprs;
}

// ---- 环境 ----
function makeEnv(parent){ return { vars: Object.create(null), parent: parent || null }; }
function envGet(env, name){
  let e = env; while(e){ if(name in e.vars) return e.vars[name]; e = e.parent; }
  return undefined;
}
function envSet(env, name, val){ env.vars[name] = val; }
function envAssign(env, name, val){
  let e = env; while(e){ if(name in e.vars){ e.vars[name] = val; return; } e = e.parent; }
  env.vars[name] = val;
}

function parseParams(paramsNode){
  const params = []; let rest = null; let i = 0;
  while(i < paramsNode.length){
    if(paramsNode[i] instanceof Sym && paramsNode[i].name === '&'){ rest = paramsNode[i+1]; i += 2; }
    else { params.push(paramsNode[i]); i++; }
  }
  return { params, rest };
}
function makeLambda(paramsNode, body, env, name){
  const { params, rest } = parseParams(paramsNode);
  return { __lambda:true, params, rest, body, env, name: name || null };
}
function makeMacro(paramsNode, body, env){
  const { params, rest } = parseParams(paramsNode);
  return { __macro:true, params, rest, body, env };
}

function evalBody(body, env){ let r = null; for(const e of body) r = ev(e, env, false); return r; }
// 体求值，仅在最后一个表达式处于尾位置
function evalBodyTCO(body, env, tail){
  let r = null;
  for(let i = 0; i < body.length; i++){
    const last = (i === body.length - 1);
    r = ev(body[i], env, last && tail);
  }
  return r;
}

// 尾调用：返回此标记，由 trampoline 循环展开
function callLambdaCore(fn, args){
  const ne = makeEnv(fn.env);
  fn.params.forEach((p, i) => { if(p instanceof Sym) ne.vars[p.name] = args[i]; else bindDestruct(p, args[i], ne); });
  if(fn.rest) ne.vars[fn.rest.name] = args.slice(fn.params.length);
  const label = fn.name || '(lambda)';
  callStack.push(label);
  try { return evalBodyTCO(fn.body, ne, true); }
  finally { callStack.pop(); }
}
function resolveTail(r){
  let steps = 0;
  while(r && r.__tail){
    if(++steps > 1000000) throw new Error('TCO 步数超限（疑似无限循环）');
    r = callLambdaCore(r.fn, r.args);
  }
  return r;
}
function applyFn(fn, args, node){
  if(typeof fn === 'function'){
    try { return fn(...args); }
    catch(err){ if(err && err.lisp && err.line === undefined) err.line = nodeLine(node); throw err; }
  }
  if(fn && fn.__lambda) return resolveTail(callLambdaCore(fn, args));
  throw lispError('不是可调用的对象: ' + lispStr(fn), node);
}
function applyMacro(m, rawArgs){
  const ne = makeEnv(m.env);
  m.params.forEach((p, i) => { if(p instanceof Sym) ne.vars[p.name] = rawArgs[i]; else bindDestruct(p, rawArgs[i], ne); });
  if(m.rest) ne.vars[m.rest.name] = rawArgs.slice(m.params.length);
  return evalBodyTCO(m.body, ne, false);  // 返回展开后的 AST
}

//  quasiquote 展开：返回一棵“表达式”(AST)，求值后得到目标数据/代码
function qq(node){
  if(node instanceof Sym) return [new Sym('quote'), node];
  if(!Array.isArray(node)) return [new Sym('quote'), node];
  if(node.length && node[0] instanceof Sym && node[0].name === 'unquote') return node[1];
  const head = qq(node[0]);
  const tail = qqTail(node.slice(1));
  return [new Sym('cons'), head, tail];
}
function qqTail(arr){
  if(arr.length === 0) return [new Sym('quote'), []];
  const first = arr[0];
  if(Array.isArray(first) && first[0] instanceof Sym && first[0].name === 'unquote-splicing'){
    return [new Sym('append'), first[1], qqTail(arr.slice(1))];
  }
  const head = qq(first);
  const tail = qqTail(arr.slice(1));
  return [new Sym('cons'), head, tail];
}

// match 模式匹配：返回 {ok, binds}；binds 为 [name, value] 数组
function matchPattern(pat, val, binds, env){
  if(pat instanceof Sym){
    const n = pat.name;
    if(n === '_' || n === 'else') return { ok:true, binds };
    binds.push([n, val]); return { ok:true, binds };
  }
  if(typeof pat === 'number' || typeof pat === 'string' || typeof pat === 'boolean')
    return { ok: pat === val, binds };
  if(pat === null) return { ok: val === null || (Array.isArray(val) && val.length === 0), binds };
  if(Array.isArray(pat)){
    if(pat.length && pat[0] instanceof Sym){
      const k = pat[0].name;
      if(k === 'list'){
        if(!Array.isArray(val) || val.length !== pat.length - 1) return { ok:false, binds };
        for(let i=0;i<pat.length-1;i++){
          const r = matchPattern(pat[i+1], val[i], binds, env);
          if(!r.ok) return r;
        }
        return { ok:true, binds };
      }
      if(k === 'cons'){
        if(!Array.isArray(val) || val.length === 0) return { ok:false, binds };
        const r1 = matchPattern(pat[1], val[0], binds, env); if(!r1.ok) return r1;
        const r2 = matchPattern(pat[2], val.slice(1), binds, env); if(!r2.ok) return r2;
        return { ok:true, binds };
      }
      if(k === 'quote'){
        const lit = pat[1];
        if(lit instanceof Sym) return { ok: val instanceof Sym && val.name === lit.name, binds };
        return { ok: lispStr(val) === lispStr(lit), binds };
      }
      if(k === '?'){
        const fnVal = envGet(env, pat[1].name);
        if(!fnVal) return { ok:false, binds };
        const r = matchPattern(pat[2], val, binds, env); if(!r.ok) return r;
        const out = applyFn(fnVal, [val]);
        return { ok: !(out === false || out === null), binds };
      }
    }
    // 普通字面量列表：整体相等
    return { ok: Array.isArray(val) && lispStr(val) === lispStr(pat), binds };
  }
  return { ok:false, binds };
}

// 解构绑定：用于 let/lambda/loop/宏 等，把模式 pat 匹配到值 val 并写入环境 ne。
// 支持：符号(绑定；_ / else 通配跳过)、嵌套数组(位置解构)、& 剩余(收集其余元素)。
function bindDestruct(pat, val, ne){
  if(pat instanceof Sym){
    const n = pat.name;
    if(n === '_' || n === 'else') return;     // 通配符，跳过绑定
    ne.vars[n] = val;
    return;
  }
  if(!Array.isArray(pat)){
    // 标量字面量模式：严格相等校验
    if(pat !== val) throw lispError('解构字面量不匹配: ' + lispStr(pat), pat);
    return;
  }
  if(!Array.isArray(val)) throw lispError('解构期望列表，得到: ' + lispStr(val), pat);
  let restIdx = -1;
  for(let i = 0; i < pat.length; i++){ if(pat[i] instanceof Sym && pat[i].name === '&'){ restIdx = i; break; } }
  if(restIdx >= 0){
    for(let i = 0; i < restIdx; i++) bindDestruct(pat[i], val[i], ne);
    const restSym = pat[restIdx + 1];
    if(!(restSym instanceof Sym)) throw lispError('& 之后须为符号', pat);
    ne.vars[restSym.name] = val.slice(restIdx);
    return;
  }
  if(pat.length > val.length) throw lispError('解构模式长度(' + pat.length + ')超过值长度(' + val.length + ')', pat);
  for(let i = 0; i < pat.length; i++) bindDestruct(pat[i], val[i], ne);
}

function ev(node, env, tail){
  if(node === null) return null;
  if(typeof node === 'number' || typeof node === 'string' || typeof node === 'boolean') return node;
  if(node instanceof Sym){
    const v = envGet(env, node.name);
    if(v === undefined) throw lispError('未定义符号: ' + node.name, node);
    return v;
  }
  if(!Array.isArray(node)) return node;
  if(node.length === 0) return [];
  const head = node[0];

  if(head instanceof Sym){
    const name = head.name;
    switch(name){
      case 'quote': return node[1];
      case 'delay':
        return new LPromise(node[1], env);
      case 'lazy-cons':
        return new LStream(ev(node[1], env, false), new LPromise(node[2], env));
      case 'quasiquote': return ev(qq(node[1]), env, tail);
      case 'load': {
        if(typeof require !== 'function') throw lispError('load 仅在 Node 环境可用', node);
        const p = String(ev(node[1], env, false));
        let src;
        try { src = require('fs').readFileSync(p, 'utf8'); }
        catch(e){ throw lispError('load 无法读取文件: ' + p, node); }
        const exprs = parseAll(src);
        let r = null;
        for(let i=0;i<exprs.length;i++) r = resolveTail(ev(exprs[i], env, i === exprs.length-1 ? tail : false));
        return r;
      }
      case 'if': {
        const t = ev(node[1], env, false);
        return (t !== false && t !== null) ? ev(node[2], env, tail) : (node.length > 3 ? ev(node[3], env, tail) : null);
      }
      case 'define': {
        const target = node[1];
        if(target instanceof Sym){ const val = ev(node[2], env, false); envSet(env, target.name, val); return target; }
        if(Array.isArray(target)){
          const fname = target[0].name;
          envSet(env, fname, makeLambda(target.slice(1), node.slice(2), env, fname));
          return new Sym(fname);
        }
        throw lispError('define 语法错误', node);
      }
      case 'defmacro': {
        const fname = node[1].name;
        envSet(env, fname, makeMacro(node[2], node.slice(3), env));
        return new Sym(fname);
      }
      case 'defstruct': {
        const name = node[1].name;
        const fields = node.slice(2).map(f => f.name);
        const ctor = (...args)=>{
          const vals = {};
          fields.forEach((f, i)=> vals[f] = args[i]);
          return { __struct: name, vals };
        };
        envSet(env, name, ctor);
        for(const f of fields){
          envSet(env, name + '-' + f, (rec)=> (rec && rec.__struct === name) ? rec.vals[f] : null);
        }
        envSet(env, name + '?', (rec)=> !!(rec && rec.__struct === name));
        return new Sym(name);
      }
      case 'defn': {
        const nameSym = node[1];
        if(!(nameSym instanceof Sym)) throw lispError('defn 第一个参数必须是函数名', node);
        let i = 2;
        let docStr = null;
        if(typeof node[i] === 'string'){ docStr = node[i]; i++; }
        const argList = node[i];
        if(!Array.isArray(argList)) throw lispError('defn 第二参数必须是参数列表', node);
        i++;
        const body = node.slice(i);
        if(body.length === 0) throw lispError('defn 函数体不能为空', node);
        if(docStr) DOCS[nameSym.name] = docStr;
        const lambdaNode = [new Sym('lambda'), argList].concat(body);
        return ev([new Sym('define'), nameSym, lambdaNode], env, tail);
      }
      case 'lambda': return makeLambda(node[1], node.slice(2), env);
      case 'let': {
        const ne = makeEnv(env);
        for(const b of node[1]){
          const v = ev(b[1], env, false);
          if(b[0] instanceof Sym) ne.vars[b[0].name] = v;
          else bindDestruct(b[0], v, ne);
        }
        return evalBodyTCO(node.slice(2), ne, tail);
      }
      case 'let*': {
        let ne = env;
        for(const b of node[1]){
          const inner = makeEnv(ne);
          const v = ev(b[1], ne, false);
          if(b[0] instanceof Sym) inner.vars[b[0].name] = v; else bindDestruct(b[0], v, inner);
          ne = inner;
        }
        return evalBodyTCO(node.slice(2), ne, tail);
      }
      case 'letrec': {       // 互递归绑定：先预占位，再按序求值（lambda 可互相引用）
        const ne = makeEnv(env);
        for(const b of node[1]){ if(b[0] instanceof Sym) ne.vars[b[0].name] = undefined; }
        for(const b of node[1]){
          const v = ev(b[1], ne, false);
          if(b[0] instanceof Sym) ne.vars[b[0].name] = v; else bindDestruct(b[0], v, ne);
        }
        return evalBodyTCO(node.slice(2), ne, tail);
      }
      case 'loop': {
        const fname = node[1].name;
        const binds = node[2];
        const bodyForms = node.slice(3);
        const ne = makeEnv(env);
        const params = binds.map(b => b[0]);   // 允许解构模式作为 loop 绑定名
        const inits = binds.map(b => ev(b[1], env, false));
        const fn = makeLambda(params, bodyForms, ne, fname);
        ne.vars[fname] = fn;
        return resolveTail(callLambdaCore(fn, inits));
      }
      case 'set!': { const val = ev(node[2], env, false); envAssign(env, node[1].name, val); return val; }
      case 'begin': return evalBodyTCO(node.slice(1), env, tail);
      case 'cond': {
        for(let i = 1; i < node.length; i++){
          const cl = node[i];
          if(cl[0] instanceof Sym && cl[0].name === 'else') return ev(cl[1], env, tail);
          const c = ev(cl[0], env, false);
          if(c !== false && c !== null) return ev(cl[1], env, tail);
        }
        return null;
      }
      case 'while': {
        let r = null;
        for(;;){
          const t = ev(node[1], env, false);
          if(t === false || t === null) return r;
          for(let i = 2; i < node.length; i++) r = ev(node[i], env, false);
        }
      }
      case 'for': {
        // (for <var> <list-expr> <body> ...) — 遍历列表，每次绑定 var 后执行 body
        if(!(node[1] instanceof Sym)) throw lispError('for 第一参数须为变量名', node);
        const varName = node[1].name;
        const seq = ev(node[2], env, false);
        const arr = Array.isArray(seq) ? seq : [];
        let r = null;
        for(const item of arr){
          const ne = makeEnv(env);
          ne.vars[varName] = item;
          for(let i = 3; i < node.length; i++) r = ev(node[i], ne, false);
        }
        return r;
      }
      case 'dotimes': {
        // (dotimes (i n) body...) — 把计数器 i 从 0 绑定到 n-1，依次执行 body，返回最后一次 body 的值（n<=0 返回 null）
        if(!(node[1] instanceof Array) || node[1].length !== 2 || !(node[1][0] instanceof Sym)) throw lispError('dotimes 第一参数须为 (变量 次数)', node);
        const varName = node[1][0].name;
        const n = Math.floor(Number(ev(node[1][1], env, false))) || 0;
        let r = null;
        for(let i = 0; i < n; i++){
          const ne = makeEnv(env);
          ne.vars[varName] = i;
          for(let k = 2; k < node.length; k++) r = ev(node[k], ne, false);
        }
        return r;
      }
      case 'par': {
        // (par expr1 expr2 ...) — 把每个子表达式包装成延迟求值的 LPromise(future)，返回 future 列表
        const futures = [];
        for(let i = 1; i < node.length; i++) futures.push(new LPromise(node[i], env));
        return futures;
      }
      case 'await': {
        // (await futures) — 强制求值 par 产生的 future（列表或单个），返回结果列表/值
        const f = ev(node[1], env, false);
        if(Array.isArray(f)) return f.map(x => forcePromise(x));
        return forcePromise(f);
      }
      case 'time': {
        // (time expr) — 求值 expr 并返回 [值, 毫秒]（求值耗时，精确到 ms）
        const t0 = Date.now();
        const v = ev(node[1], env, true);
        const ms = Date.now() - t0;
        return [v, ms];
      }
      case 'with-time': {
        // (with-time expr) — 求值 expr 并打印耗时（控制台），返回 expr 的值
        const t0 = Date.now();
        const v = ev(node[1], env, true);
        const ms = Date.now() - t0;
        if(typeof console !== 'undefined') console.log('[with-time] 耗时 ' + ms + ' ms');
        return v;
      }
      case '->': {   // 线程宏（Clojure 风格）：把上一步结果插入下一表单的【第二个】位置
        let x = ev(node[1], env, false);
        for(let i = 2; i < node.length; i++){
          const f = node[i];
          const form = Array.isArray(f) ? [f[0], x, ...f.slice(1)] : [f, x];
          x = ev(form, env, false);
        }
        return x;
      }
      case '->>': {  // 线程宏（Clojure 风格）：把上一步结果插入下一表单的【最后一个】位置
        let x = ev(node[1], env, false);
        for(let i = 2; i < node.length; i++){
          const f = node[i];
          const form = Array.isArray(f) ? [...f, x] : [f, x];
          x = ev(form, env, false);
        }
        return x;
      }
      case 'case': {
        const v = ev(node[1], env, false);
        for(let i = 2; i < node.length; i++){
          const cl = node[i];
          if(cl[0] instanceof Sym && cl[0].name === 'else') return evalBodyTCO(cl.slice(1), env, tail);
          const pat = cl[0];
          const hit = Array.isArray(pat)
            ? pat.map(x => lispStr(x)).includes(lispStr(v))
            : lispStr(pat) === lispStr(v);
          if(hit) return evalBodyTCO(cl.slice(1), env, tail);
        }
        return null;
      }
      case 'and': { let r = true; for(let i = 1; i < node.length; i++){ r = ev(node[i], env, false); if(r === false || r === null) return r; } return r; }
      case 'or': { for(let i = 1; i < node.length; i++){ const r = ev(node[i], env, false); if(r !== false && r !== null) return r; } return false; }
      case 'match': {
        const val = ev(node[1], env, false);
        for(let i = 2; i < node.length; i++){
          const cl = node[i];
          const res = matchPattern(cl[0], val, [], env);
          if(res.ok){
            const ne = makeEnv(env);
            for(const [nm, v] of res.binds) ne.vars[nm] = v;
            return evalBodyTCO(cl.slice(1), ne, tail);
          }
        }
        return null;
      }
      case 'try': {
        const last = node[node.length - 1];
        const hasCatch = last && Array.isArray(last) && last[0] instanceof Sym && last[0].name === 'catch';
        const body = hasCatch ? node.slice(1, node.length - 1) : node.slice(1);
        try {
          let r = null;
          for(const e of body) r = ev(e, env, false);
          return r;
        } catch(err) {
          if(hasCatch){
            const ne = makeEnv(env);
            ne.vars[last[1].name] = (err && err.message) ? err.message : String(err);
            return ev(last[2], ne, tail);
          }
          throw err;
        }
      }
      case 'defmodule': {
        const mname = node[1].name;
        const exportList = node[2];
        if(!(exportList instanceof Array) || !(exportList[0] instanceof Sym) || exportList[0].name !== 'export')
          throw lispError('defmodule 第二参数须为 (export ...)', node);
        const expSyms = exportList.slice(1).map(s => s.name);
        const me = makeEnv(env);
        for(let i = 3; i < node.length; i++) ev(node[i], me, false);
        const mod = {};
        for(const s of expSyms) mod[s] = me.vars[s];
        modules[mname] = mod;
        return new Sym(mname);
      }
      case 'require': {
        const mname = node[1].name;
        const mod = modules[mname];
        if(!mod) throw lispError('未定义模块: ' + mname, node);
        const picks = node.length > 2 ? node.slice(2).map(s => s.name) : Object.keys(mod);
        for(const s of picks){
          if(!(s in mod)) throw lispError('模块 ' + mname + ' 未导出: ' + s, node);
          envSet(env, s, mod[s]);
        }
        return new Sym(mname);
      }
    }
  }

  // 宏展开
  if(head instanceof Sym){
    const fnVal = envGet(env, head.name);
    if(fnVal && fnVal.__macro){
      const expanded = applyMacro(fnVal, node.slice(1));
      return ev(expanded, env, tail);
    }
  }

  // 普通函数调用
  const fn = ev(head, env, false);
  const args = node.slice(1).map(a => ev(a, env, false));
  if(fn && fn.__lambda){
    if(tail) return { __tail:true, fn, args };
    return resolveTail(callLambdaCore(fn, args));
  }
  if(typeof fn === 'function') return applyFn(fn, args, head);
  throw lispError('不是可调用的对象: ' + lispStr(fn), head);
}

// ---- 深比较：跨 list/dict/set/struct/sym 按值比较（不可变结构语义）----
function deepEqual(a, b){
  if(a === b) return true;
  if(a instanceof Sym || b instanceof Sym) return (a instanceof Sym) && (b instanceof Sym) && a.name === b.name;
  if(Array.isArray(a) && Array.isArray(b)){
    if(a.length !== b.length) return false;
    for(let i = 0; i < a.length; i++) if(!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if(a instanceof Dict && b instanceof Dict){
    if(a.len !== b.len) return false;
    for(const k of a.keys()){ if(!b.has(k)) return false; if(!deepEqual(a.get(k), b.get(k))) return false; }
    return true;
  }
  if(a instanceof LSet && b instanceof LSet){
    if(a.len !== b.len) return false;
    for(const v of a.keys()) if(!b.has(v)) return false;
    return true;
  }
  if(a instanceof LTree && b instanceof LTree){
    if(!deepEqual(a.value, b.value)) return false;
    return deepEqual(a.children, b.children);
  }
  if(a && a.__struct && b && b.__struct){
    if(a.__struct !== b.__struct) return false;
    for(const k in a.vals) if(!deepEqual(a.vals[k], b.vals[k])) return false;
    return true;
  }
  return false;
}

// ---- 文档字符串注册表（help / doc / docs 用）----
const DOCS = {};

// ---- 内置函数 ----
// 模块级 gensym 计数器：run() 每次 newEnv 都会重跑 setupBuiltins，故放在模块级以跨 run 保持唯一
let GENSYM_COUNTER = 0;
function setupBuiltins(env){
  const def = (n, f, doc) => { env.vars[n] = f; if(doc){ f.__doc = doc; DOCS[n] = doc; } return f; };
  DOCS['->']  = '线程宏：把前一步结果插入下一表单的第二个位置，串联多次调用。例 (-> 5 (+ 3) (* 2)) => 16';
  DOCS['->>'] = '线程宏：把前一步结果插入下一表单的最后一个位置。例 (->> 5 (+ 3) (* 2)) => 16';
  DOCS['defn'] = '函数语法糖：把 (defn 名 (参数…) 体…) 展开为 (define 名 (lambda (参数…) 体…))；第二参数若为字符串则作为文档串登记。例 (defn sq (x) (* x x)) 后 (sq 5) => 25';
  // when / unless 条件宏：用 list/cons 构造输出 AST（把 test 原样拼入 if，待运行时再求值），
  // 命中(或 unless 取反命中)才顺序求值体(begin)并返回末值，否则返回 null
  env.vars['when'] = makeMacro([new Sym('test'), new Sym('&'), new Sym('body')],
    [[new Sym('list'), [new Sym('quote'), new Sym('if')], new Sym('test'),
      [new Sym('cons'), [new Sym('quote'), new Sym('begin')], new Sym('body')]]], env);
  env.vars['unless'] = makeMacro([new Sym('test'), new Sym('&'), new Sym('body')],
    [[new Sym('list'), [new Sym('quote'), new Sym('if')],
      [new Sym('list'), [new Sym('quote'), new Sym('not')], new Sym('test')],
      [new Sym('cons'), [new Sym('quote'), new Sym('begin')], new Sym('body')]]], env);
  DOCS['when']   = '条件宏：当 test 为真时顺序求值体(begin)并返回末值，否则返回 null。例 (when (> 3 2) (print "yes") 42) => 42';
  DOCS['unless'] = '条件宏：当 test 为假时顺序求值体(begin)并返回末值，否则返回 null（与 when 相反）。例 (unless false 7) => 7';
  // ---- 宏调试与卫生 ----
  const STOP_Q = new Set(['quote','quasiquote','unquote','unquote-splicing']);
  // 仅展开头部一次（若头部是已定义宏），否则原样返回
  function macroexpand1(form){
    if(form instanceof Array && form.length && form[0] instanceof Sym){
      const fnVal = envGet(env, form[0].name);
      if(fnVal && fnVal.__macro) return applyMacro(fnVal, form.slice(1));
    }
    return form;
  }
  // 完全展开：递归进子表达式；quote/quasiquote/unquote 内部不展开（避免吞掉用户引用）
  function macroexpandAll(form){
    if(!(form instanceof Array)) return form;
    if(form.length && form[0] instanceof Sym){
      const name = form[0].name;
      if(STOP_Q.has(name)) return form;
      const fnVal = envGet(env, name);
      if(fnVal && fnVal.__macro) return macroexpandAll(applyMacro(fnVal, form.slice(1)));
    }
    return form.map(macroexpandAll);
  }
  def('gensym', (p)=>{
      const pre = (typeof p === 'string' && p) ? p : 'g';
      return new Sym(pre + (++GENSYM_COUNTER));
    }, '生成唯一符号 gensym([前缀])：每次调用返回不同符号，用于宏卫生，避免名字捕获冲突。');
  def('macroexpand-1', (form)=> macroexpand1(form),
      '展开一次宏调用：若头部是已定义宏则展开一步，否则原样返回。用于检视单步宏展开。');
  def('macroexpand', (form)=> macroexpandAll(form),
      '完全展开所有(含嵌套)宏调用，返回纯代码；quote/quasiquote/unquote 内部不展开。');
  def('+', (...a)=> a.reduce((x,y)=>x+y, 0));
  def('-', (a,...r)=> r.length ? r.reduce((x,y)=>x-y, a) : -a);
  def('*', (...a)=> a.reduce((x,y)=>x*y, 1));
  def('/', (a,...r)=>{
    if(r.length){ if(r.some(y => y === 0)) throw lispError('除以零'); return r.reduce((x,y)=>x/y, a); }
    if(a === 0) throw lispError('除以零'); return 1/a;
  });
  def('=', (a,b)=> a===b);
  def('<', (a,b)=> a<b); def('>', (a,b)=> a>b);
  def('<=', (a,b)=> a<=b); def('>=', (a,b)=> a>=b);
  def('not', (a)=> a===false || a===null);
  def('list', (...a)=> a);
  def('cons', (a,b)=> [a, ...(Array.isArray(b) ? b : [b])]);
  def('append', (...ls)=>{ let r=[]; for(const l of ls){ if(Array.isArray(l)) r=r.concat(l); else r.push(l); } return r; });
  def('car', (l)=> Array.isArray(l) ? (l[0] ?? null) : null);
  def('cdr', (l)=> Array.isArray(l) ? l.slice(1) : null);
  def('null?', (l)=> l===null || (Array.isArray(l) && l.length===0));
  def('list?', (x)=> Array.isArray(x));
  def('number?', (x)=> typeof x==='number');
  def('symbol?', (x)=> x instanceof Sym);
  def('string?', (x)=> typeof x==='string');
  def('boolean?', (x)=> typeof x==='boolean');
  def('float?', (x)=> typeof x==='number' && !Number.isInteger(x));
  def('pos?', (x)=> typeof x==='number' && x>0);
  def('neg?', (x)=> typeof x==='number' && x<0);
  def('bool?', (x)=> typeof x==='boolean');
  def('function?', (x)=> typeof x==='function' || (x && x.__lambda) === true);
  def('nil?', (x)=> x===null || (Array.isArray(x) && x.length===0));
  def('empty?', (x)=> x===null || (Array.isArray(x) && x.length===0) || (typeof x==='string' && x.length===0));
  def('eq?', (a,b)=> a===b);
  def('equal?', (a,b)=> deepEqual(a,b));
  def('mod', (a,b)=> { if(b===0) throw lispError('mod: 除以零'); return ((a%b)+b)%b; });
  def('sqrt', (a)=> Math.sqrt(a));
  def('abs', (a)=> Math.abs(a));
  def('print', (...a)=> a.map(lispStr).join(' '));
  def('range', (a, b, step)=> {
    if(b === undefined){ const r=[]; for(let i=0;i<a;i++) r.push(i); return r; }
    const st = (step === undefined) ? 1 : step;
    const r = [];
    if(st > 0){ for(let i=a; i<b; i+=st) r.push(i); }
    else if(st < 0){ for(let i=a; i>b; i+=st) r.push(i); }
    return r;
  });
  def('length', (x)=> Array.isArray(x) ? x.length : (typeof x==='string' ? x.length : 0));
  def('map', (f,l)=> Array.isArray(l) ? l.map(x=>applyFn(f,[x])) : []);
  def('filter', (f,l)=> Array.isArray(l) ? l.filter(x=>applyFn(f,[x])) : []);
  def('reduce', (f,init,l)=> Array.isArray(l) ? l.reduce((a,x)=>applyFn(f,[a,x]), init) : init);
  def('apply', (f,l)=> applyFn(f, Array.isArray(l)?l:[]));

  // 函数组合：返回新函数 (comp f g h) => x => f(g(h(x)))，参数透传给最右侧函数
  def('comp', (...fns) => {
    if(fns.length === 0) return (x)=> x;
    return (...args) => {
      let r = applyFn(fns[fns.length-1], args);
      for(let i = fns.length-2; i >= 0; i--) r = applyFn(fns[i], [r]);
      return r;
    };
  });
  // 偏应用：返回新函数，调用时把预设的前缀参数拼在前面 (partial f a b) => (...rest) => f(a, b, ...rest)
  def('partial', (fn, ...pre) => (...rest) => applyFn(fn, pre.concat(rest)));

  // ---- 序列折叠 / 压缩 ----
  def('foldl', (f, init, l)=> Array.isArray(l) ? l.reduce((a,x)=>applyFn(f,[a,x]), init) : init);
  def('foldr', (f, init, l)=> Array.isArray(l) ? l.reduceRight((a,x)=>applyFn(f,[x,a]), init) : init);
  def('for-each', (f, l)=>{ if(Array.isArray(l)) l.forEach(x=>applyFn(f,[x])); return null; });
  // memoize：记忆化高阶函数，按参数元组(序列化)缓存结果，重复调用直接返回缓存
  def('memoize', (f)=>{
    const cache = new Map();
    const mf = (...args)=>{
      const k = args.map(a => lispStr(a)).join('\u0001');
      if(cache.has(k)) return cache.get(k);
      const r = applyFn(f, args);
      cache.set(k, r);
      return r;
    };
    mf.__memoCache = cache;
    return mf;
  });
  // memoized?：判断对象是否为 memoize 产生的记忆化函数
  def('memoized?', (f)=> !!(f && f.__memoCache));
  // memo-cache-size：返回记忆化函数当前缓存条目数（便于测试/调试）
  def('memo-cache-size', (f)=> (f && f.__memoCache) ? f.__memoCache.size : 0);
  def('zip', (...ls)=>{
    let n = Infinity;
    for(const l of ls){ if(!Array.isArray(l)){ n = 0; break; } n = Math.min(n, l.length); }
    if(!isFinite(n)) n = 0;
    const r = [];
    for(let i=0;i<n;i++) r.push(ls.map(l => Array.isArray(l) ? l[i] : null));
    return r;
  });
  // 关联列表 (alist)：等号比较统一用 lispStr，使 sym/num/str 都能当键
  def('assoc', (k, al)=>{
    if(!Array.isArray(al)) return null;
    for(const p of al){ if(Array.isArray(p) && lispStr(p[0]) === lispStr(k)) return p; }
    return null;
  });
  def('acons', (k, v, al)=> [[k, v], ...(Array.isArray(al) ? al : [])]);

  // ---- 哈希表 (dict, O(1) 查找，替代慢速关联列表) ----
  def('dict', (...args)=>{
    const d = new Dict();
    if(args.length === 1 && Array.isArray(args[0])){            // (dict '((a 1) (b 2)))
      for(const p of args[0]){ if(Array.isArray(p) && p.length>=2) d.put(p[0], p[1], true); }
      return d;
    }
    for(let i=0; i+1<args.length; i+=2) d.put(args[i], args[i+1], true);  // (dict 'a 1 'b 2)
    return d;
  });
  def('dict?', (x)=> x instanceof Dict);
  def('dict-get', (d, k, defv)=> (d instanceof Dict && d.has(k)) ? d.get(k) : (defv===undefined ? null : defv));
  def('dict-has?', (d, k)=> (d instanceof Dict) ? d.has(k) : false);
  def('dict-set', (d, k, v)=> { if(!(d instanceof Dict)) throw lispError('dict-set 需要 dict'); return d.put(k, v, false); });
  def('dict-del', (d, k)=> { if(!(d instanceof Dict)) throw lispError('dict-del 需要 dict'); return d.del(k); });
  def('dict-keys', (d)=> (d instanceof Dict) ? d.keys() : []);
  def('dict-vals', (d)=> (d instanceof Dict) ? d.vals() : []);
  def('dict-len', (d)=> (d instanceof Dict) ? d.len : 0);

  // ---- 集合 (Set, 以 lispStr 去重，不可变) ----
  def('set', (...args)=>{ const s = new LSet(); for(const a of args) s.add(a, true); return s; });
  def('set?', (x)=> x instanceof LSet);
  def('set-add', (s, v)=> { if(!(s instanceof LSet)) throw lispError('set-add 需要 set'); return s.add(v, false); });
  def('set-has?', (s, v)=> (s instanceof LSet) ? s.has(v) : false);
  def('set-del', (s, v)=> { if(!(s instanceof LSet)) throw lispError('set-del 需要 set'); return s.del(v); });
  def('set-len', (s)=> (s instanceof LSet) ? s.len : 0);
  def('set->list', (s)=> (s instanceof LSet) ? s.keys() : []);
  def('set-union', (a, b)=> { if(!(a instanceof LSet) || !(b instanceof LSet)) throw lispError('set-union 需要 set'); const r = a._clone(); for(const v of b.keys()) r.add(v, true); return r; });
  def('set-intersect', (a, b)=> { if(!(a instanceof LSet) || !(b instanceof LSet)) throw lispError('set-intersect 需要 set'); const r = new LSet(); for(const v of a.keys()) if(b.has(v)) r.add(v, true); return r; });

  // ---- 树 (n 叉树 LTree：value + children，不可变) ----
  def('tree', (value, ...children)=>{ for(const c of children) if(!(c instanceof LTree)) throw lispError('tree 子节点必须是 tree'); return new LTree(value, children); });
  def('leaf', (value)=> new LTree(value, []));
  def('tree?', (x)=> x instanceof LTree);
  def('tree-value', (t)=>{ if(!(t instanceof LTree)) throw lispError('tree-value 需要 tree'); return t.value; });
  def('tree-children', (t)=>{ if(!(t instanceof LTree)) throw lispError('tree-children 需要 tree'); return t.children; });
  def('tree-map', (f, t)=> treeMap(f, t));
  def('tree-fold', (f, init, t)=> treeFold(f, init, t));
  def('tree-seq', (t)=> treeSeq(t));
  def('tree-find', (pred, t)=> treeFind(pred, t));
  def('tree-depth', (t)=> treeDepth(t));
  def('tree-size', (t)=> treeSize(t));

  // ---- 数值与数学 ----
  def('min', (...a)=> Math.min(...a));
  def('max', (...a)=> Math.max(...a));
  def('floor', (a)=> Math.floor(a));
  def('ceil', (a)=> Math.ceil(a));
  def('round', (a)=> Math.round(a));
  def('pow', (a,b)=> Math.pow(a,b));
  def('exp', (a)=> Math.exp(a));
  def('log', (a)=> Math.log(a));
  def('sin', (a)=> Math.sin(a));
  def('cos', (a)=> Math.cos(a));
  def('tan', (a)=> Math.tan(a));
  def('pi', Math.PI);

  // ---- 位运算（32 位有符号整数语义，输入截断为 int32）----
  const i32 = (a)=> Math.trunc(a) | 0;
  def('bit-and', (a,b)=> i32(a) & i32(b));
  def('bit-or',  (a,b)=> i32(a) | i32(b));
  def('bit-xor', (a,b)=> i32(a) ^ i32(b));
  def('bit-not', (a)=> ~i32(a));
  def('bit-shift-left',  (a,n)=> i32(a) << (i32(n) & 31));
  def('bit-shift-right', (a,n)=> i32(a) >> (i32(n) & 31));
  def('bit-shift-right-logical', (a,n)=> i32(a) >>> (i32(n) & 31));

  // ---- 数值与数学（扩容）----
  // gcd / lcm：整数最大公约 / 最小公倍（0 与任何数 gcd=该数绝对值，lcm=0）
  def('gcd', (a,b)=>{
    a = Math.trunc(a); b = Math.trunc(b);
    a = Math.abs(a); b = Math.abs(b);
    while(b){ const t = b; b = a % b; a = t; }
    return a;
  });
  def('lcm', (a,b)=>{
    a = Math.trunc(a); b = Math.trunc(b);
    if(a === 0 || b === 0) return 0;
    const g = (function gcd(x,y){ x=Math.abs(x); y=Math.abs(y); while(y){ const t=y; y=x%y; x=t; } return x; })(a,b);
    return Math.abs(a*b) / g;
  });
  // signum：符号（-1 / 0 / 1）
  def('signum', (a)=> a > 0 ? 1 : (a < 0 ? -1 : 0));
  // 整数除法：floor-div 向负无穷、quotient 向零截断；除零抛错
  def('floor-div', (a,b)=>{ if(b === 0) throw lispError('floor-div: 除以零'); return Math.floor(a / b); });
  def('quotient', (a,b)=>{ if(b === 0) throw lispError('quotient: 除以零'); return Math.trunc(a / b); });
  // random-int：随机整数，单参 [0,n)、双参 [a,b]（含端点）
  def('random-int', (a,b)=>{
    if(b === undefined){ return Math.floor(Math.random() * Math.ceil(a || 1)); }   // [0,n)
    a = Math.ceil(a); b = Math.floor(b);
    if(a > b) throw lispError('random-int: 区间无效 a>b');
    return a + Math.floor(Math.random() * (b - a + 1));                            // [a,b] 含端点
  });
  // 整数谓词（3.0 视为整数）
  def('integer?', (x)=> typeof x === 'number' && Number.isInteger(x));

  // ---- 谓词 ----
  def('even?', (a)=> a % 2 === 0);
  def('odd?', (a)=> Math.abs(a % 2) === 1);
  def('zero?', (a)=> a === 0);
  def('positive?', (a)=> a > 0);
  def('negative?', (a)=> a < 0);

  // ---- 字符串 ----
  def('string-append', (...a)=> a.map(x => typeof x==='string' ? x : lispStr(x)).join(''));
  def('substring', (s, i, j)=> String(s).slice(i, j));
  def('string-length', (s)=> String(s).length);
  def('string-upcase', (s)=> String(s).toUpperCase());
  def('string-downcase', (s)=> String(s).toLowerCase());
  def('string-trim', (s)=> String(s).trim());
  def('string-reverse', (s)=> String(s).split('').reverse().join(''));
  def('string-contains?', (s, sub)=> String(s).includes(String(sub)));
  def('string-split', (s, sep)=> String(s).split(sep === undefined ? /\s+/ : String(sep)));
  def('string-join', (l, sep)=> Array.isArray(l) ? l.map(x => typeof x==='string'?x:lispStr(x)).join(String(sep||'')) : '');
  def('string-replace', (s, old, neu)=> String(s).split(String(old)).join(String(neu)));
  // ---------- 正则表达式内置（基于 JS RegExp）----------
  const mkRe = (pattern, flags)=> new RegExp(String(pattern), flags == null ? '' : String(flags));
  const mkReG = (pattern, flags)=>{ let f = (flags == null ? '' : String(flags)); if(!f.includes('g')) f += 'g'; return new RegExp(String(pattern), f); };
  def('regex-match', (pattern, str, flags)=> { const m = String(str).match(mkRe(pattern, flags)); return m || null; });
  def('regex-test',  (pattern, str, flags)=> mkRe(pattern, flags).test(String(str)));
  def('regex-find-all', (pattern, str, flags)=> String(str).match(mkReG(pattern, flags)) || []);
  def('regex-replace', (pattern, str, repl, flags)=> String(str).replace(mkReG(pattern, flags), String(repl)));
  def('regex-split', (pattern, str, flags)=> String(str).split(mkRe(pattern, flags)));
  // ---------- JSON 序列化（与宿主环境互操作）----------
  function jsonEnc(v){
    if(v === null || v === undefined) return null;
    if(typeof v === 'number' || typeof v === 'string') return v;
    if(Array.isArray(v)) return v.map(jsonEnc);
    if(v instanceof Dict){
      const o = {};
      for(const k of v.keys()){ const kk = (typeof k === 'string') ? k : lispStr(k); o[kk] = jsonEnc(v.get(k)); }
      return o;
    }
    if(v instanceof LSet) return [...v.keys()].map(jsonEnc);
    if(typeof v === 'boolean') return v;
    if(typeof v === 'object'){ const o = {}; for(const kk of Object.keys(v)) o[kk] = jsonEnc(v[kk]); return o; }
    return String(v);                                  // Sym 等 → 字符串
  }
  function jsonDec(x){
    if(x === null || x === undefined) return null;
    if(typeof x === 'number' || typeof x === 'boolean' || typeof x === 'string') return x;
    if(Array.isArray(x)) return x.map(jsonDec);
    if(x && typeof x === 'object'){
      const d = new Dict();
      for(const k of Object.keys(x)) d.put(k, jsonDec(x[k]), true);
      return d;
    }
    return x;
  }
  def('json-encode', (v)=> JSON.stringify(jsonEnc(v)));
  def('json-decode', (s)=> { try { return jsonDec(JSON.parse(String(s))); } catch(e){ throw lispError('json-decode: ' + e.message); } });
  def('json?', (s)=> { try { JSON.parse(String(s)); return true; } catch(e){ return false; } });
  // 格式化输出：~a=lispStr, ~s=原串, ~d=数字, ~%=换行, ~~=~, 其余透传
  def('format', (fmt, ...args)=>{
    let i = 0, out = ''; const s = String(fmt);
    for(let k=0;k<s.length;k++){
      if(s[k] === '~'){
        const c = s[k+1]; k++;
        if(c === 'a') out += (i<args.length ? lispStr(args[i++]) : '~a');
        else if(c === 's') out += (i<args.length ? String(args[i++]) : '~s');
        else if(c === 'd') out += (i<args.length ? String(args[i++]) : '~d');
        else if(c === '%') out += '\n';
        else if(c === '~') out += '~';
        else out += '~' + c;
      } else out += s[k];
    }
    return out;
  });

  // ---- 列表增强 ----
  def('list-ref', (l, i)=> Array.isArray(l) ? (l[i] ?? null) : null);
  def('reverse', (l)=> Array.isArray(l) ? l.slice().reverse() : []);
  def('take', (l, n)=> Array.isArray(l) ? l.slice(0, n) : []);
  def('nth', (l, i)=> Array.isArray(l) ? (l[i] ?? null) : null);
  // 序列工具补全：排序 / 切片 / 取尾 / 取末 / 扁平化 / 谓词聚合
  def('sort', (l, cmp)=> {
    if(!Array.isArray(l)) return [];
    const r = l.slice();
    if(cmp === undefined) r.sort((x,y)=> (x<y)?-1:(x>y)?1:0);
    else r.sort((x,y)=> { const v = applyFn(cmp,[x,y]); return (v===true||v>0)?-1:(v===false||v<0)?1:0; });
    return r;
  });
  def('drop', (l, n)=> Array.isArray(l) ? l.slice(n) : []);
  def('last', (l)=> (Array.isArray(l) && l.length) ? l[l.length-1] : null);
  def('flatten', (l)=> {
    const out = [];
    const walk = (x)=>{ if(Array.isArray(x)) x.forEach(walk); else out.push(x); };
    if(Array.isArray(l)) l.forEach(walk);
    return out;
  });
  def('any?', (f, l)=> {
    if(!Array.isArray(l)) return false;
    for(const x of l){ const v = applyFn(f,[x]); if(v !== false && v !== null) return true; }
    return false;
  });
  def('every?', (f, l)=> {
    if(!Array.isArray(l)) return true;
    for(const x of l){ const v = applyFn(f,[x]); if(v === false || v === null) return false; }
    return true;
  });

  // ---- 惰性求值：delay / force / promise? ----
  def('force', (p)=> forcePromise(p));
  def('promise?', (x)=> x instanceof LPromise);
  // ---- 惰性序列：lazy-cons / lazy-car / lazy-cdr / lazy-null? / lazy-take ----
  def('lazy-car', (s)=> (s instanceof LStream) ? s.head : (Array.isArray(s) ? (s[0] ?? null) : null));
  def('lazy-cdr', (s)=> (s instanceof LStream) ? forcePromise(s.tail) : (Array.isArray(s) ? s.slice(1) : null));
  def('lazy-null?', (s)=> s === null || (Array.isArray(s) && s.length === 0));
  def('lazy-take', (n, s)=>{
    const r = []; let cur = s; let k = 0;
    while(k < n && cur !== null && !(Array.isArray(cur) && cur.length === 0)){
      if(!(cur instanceof LStream)){ r.push(cur); break; }
      r.push(cur.head); cur = forcePromise(cur.tail); k++;
    }
    return r;
  });

  // ---- 元编程 / 错误 ----
  def('eval', (x)=> {
    if(typeof x === 'string'){
      const exprs = parseAll(x); let r = null;
      const e = newEnv();
      for(const ex of exprs) r = resolveTail(ev(ex, e, true));
      return r;
    }
    return resolveTail(ev(x, newEnv(), true));
  });
  def('error', (msg)=> { throw lispError(typeof msg === 'string' ? msg : lispStr(msg)); });

  // ---- Node 文件 IO / 进程（浏览器环境降级为“不支持”）----
  def('argv', ()=> (typeof process !== 'undefined' && process.argv) ? process.argv.slice(2).map(String) : []);
  def('read-file', (p)=> {
    if(typeof require !== 'function') throw lispError('read-file 仅在 Node 环境可用');
    return require('fs').readFileSync(String(p), 'utf8');
  });
  def('write-file', (p, content)=> {
    if(typeof require !== 'function') throw lispError('write-file 仅在 Node 环境可用');
    require('fs').writeFileSync(String(p), String(content), 'utf8');
    return null;
  });
  def('file-exists?', (p)=> {
    if(typeof require !== 'function') return false;
    return require('fs').existsSync(String(p));
  });
  def('delete-file', (p)=> {
    if(typeof require !== 'function') throw lispError('delete-file 仅在 Node 环境可用');
    require('fs').unlinkSync(String(p));
    return null;
  });
  def('exit', (code)=> {
    if(typeof process !== 'undefined') process.exit(code == null ? 0 : (typeof code === 'number' ? code : (Number(code) || 0)));
    throw lispError('exit 仅在 Node 环境可用');
  });

  // ---- 文档查询（help / doc / docs）----
  // help：查询某个符号的帮助（内置/函数）。接受符号或字符串，返回说明文本。
  def('help', (sym)=>{
    const name = sym instanceof Sym ? sym.name : (typeof sym === 'string' ? sym : lispStr(sym));
    const d = DOCS[name];
    if(d) return name + ': ' + d;
    return '没有「' + name + '」的文档（可能未登记，或为自定义/标准库符号）';
  });
  // doc：返回某符号的文档字符串（无则 null）
  def('doc', (sym)=>{
    const name = sym instanceof Sym ? sym.name : (typeof sym === 'string' ? sym : lispStr(sym));
    return DOCS[name] ?? null;
  });
  // docs：返回所有已登记文档的内置名列表（按字母序）
  def('docs', ()=> Object.keys(DOCS).sort());

  // 为核心内置补登文档字符串（供 help/doc 使用；D 同时写回函数的 __doc）
  const D = (n, s)=> { DOCS[n] = s; const fn = env.vars[n]; if(fn && typeof fn === 'object' && fn.__doc === undefined) fn.__doc = s; };
  D('load', '载入并执行一个 .lisp 文件：在当前环境求值其全部顶层表单，返回文件最后一个表达式的值；文件内 define 直接注入当前环境，可见后续代码');
  D('+', '加法：返回所有参数的和（零个参数时为 0）');
  D('-', '减法：单参取负；多参从第一个数依次减去其余');
  D('*', '乘法：返回所有参数的积');
  D('/', '除法：单参取倒数；多参从第一个数依次除以其余（除零抛错）');
  D('=', '相等判定（按引用/值 ===）');
  D('<', '小于：a < b');
  D('>', '大于：a > b');
  D('<=', '小于等于');
  D('>=', '大于等于');
  D('not', '逻辑非：false 或 null 为真，其余为假');
  D('while', '条件循环：(while 测试 体 ...) 反复求值体，直到测试为假/null 才停止；返回最后一次体的值（未执行则 null）');
  D('for', '列表遍历：(for 变量 列表 体 ...) 依次把列表每个元素绑定到变量并执行体，返回最后一次体的值');
  D('dotimes', '计数循环：(dotimes (变量 次数) 体 ...) 把计数器从 0 绑到 次数-1 依次执行体，返回最后一次体的值；次数<=0 返回 null');
  D('par', '轻量并发：把多个表达式包装成延迟求值的 future 列表，返回 future 列表（尚未计算）');
  D('await', '等待 future：(await futures) 强制求值 par 产生的 future（列表或单个），返回结果列表/值');
  D('time', '计时求值：(time expr) 返回 [值, 毫秒] 列表，毫秒为 expr 的求值耗时');
  D('with-time', '计时执行：(with-time expr) 求值 expr 并打印耗时，返回 expr 的值');
  D('list', '构造列表：返回所有参数组成的列表');
  D('cons', '在列表/值前追加元素：(cons a b)');
  D('car', '取列表首元素');
  D('cdr', '取列表除首元素外的剩余部分');
  D('null?', '判断是否为空列表或 null');
  D('list?', '判断是否为列表');
  D('number?', '判断是否为数字');
  D('symbol?', '判断是否为符号');
  D('string?', '判断是否为字符串');
  D('boolean?', '判断是否为布尔');
  D('float?', '判断是否为带小数的浮点数（数字且非整数）');
  D('pos?', '判断是否为正数（>0）');
  D('neg?', '判断是否为负数（<0）');
  D('bool?', '判断是否为布尔（bool? 是 boolean? 的别名）');
  D('function?', '判断是否为函数（原生函数或 lambda 闭包）');
  D('nil?', '判断是否为空列表或 null（nil? 是 null? 的别名）');
  D('empty?', '判断是否为空：空列表 / null / 空字符串');
  D('eq?', '引用相等判定');
  D('equal?', '深比较相等（跨 list/dict/set/struct/tree 按值）');
  D('map', '映射：对列表每个元素应用函数，返回新列表');
  D('filter', '过滤：保留谓词为真的元素');
  D('reduce', '归约：用函数把列表累积为单个值');
  D('apply', '把函数应用到参数列表上');
  D('comp', '函数组合：(comp f g h) 返回新函数，调用时等价于 f(g(h(参数…)))，参数透传给最右函数；零参时返回恒等函数');
  D('partial', '偏应用：(partial f a b) 返回新函数，调用时等价于 f(a, b, 余下参数…)，用于固定前若干个参数');
  D('range', '生成整数列表：(range n) 为 0..n-1；(range a b [step]) 为 a 起、步长 step 直到越过 b');
  D('sort', '排序列表：无比较器按数值/字典序；给定 (cmp a b) 谓词则按其正负/真假决定次序');
  D('drop', '丢弃列表前 n 个元素，返回剩余');
  D('last', '返回列表最后一个元素（空列表为 null）');
  D('flatten', '把任意嵌套列表拍平为一维列表');
  D('any?', '谓词对任意元素为真则返回真（空列表为否）');
  D('every?', '谓词对所有元素为真则返回真（空列表为真）');
  D('length', '返回列表或字符串长度');
  D('print', '打印并返回各参数的字符串表示（空格分隔）');
  D('help', '查询符号帮助：返回其文档说明文本');
  D('doc', '返回符号的文档字符串（无则 null）');
  D('docs', '返回所有已登记文档的内置名列表');
  D('regex-match', '正则匹配：返回首个匹配（列表，含捕获组）或 null');
  D('regex-test', '正则测试：是否匹配，返回布尔');
  D('regex-find-all', '正则全匹配：返回所有匹配组成的列表');
  D('regex-replace', '正则替换：按正则全局替换，返回新字符串');
  D('regex-split', '正则分割：按正则把字符串切分为列表');
  D('json-encode', 'JSON 序列化：把 Sibilant 值（数/串/布尔/列表/Dict/Set）转为 JSON 字符串');
  D('json-decode', 'JSON 反序列化：把 JSON 字符串解析为 Sibilant 值（数组→列表、对象→Dict）');
  D('json?', '判断字符串是否为合法 JSON');
}

function lispStr(v){
  if(v === null) return '()';
  if(v === true) return '#t';
  if(v === false) return '#f';
  if(typeof v === 'number') return String(v);
  if(typeof v === 'string') return '"' + v + '"';
  if(v instanceof Sym) return v.name;
  if(Array.isArray(v)) return '(' + v.map(lispStr).join(' ') + ')';
  if(typeof v === 'function') return '#<builtin>';
  if(v && v.__lambda) return '#<lambda>';
  if(v && v.__macro) return '#<macro>';
  if(v instanceof Dict) return '#{' + v.keys().map(k=> lispStr(k) + ' ' + lispStr(v.get(k))).join(' ') + '}';
  if(v instanceof LSet) return '#{' + v.keys().map(k=> lispStr(k)).join(' ') + '}';
  if(v instanceof LPromise) return '#<promise>';
  if(v instanceof LStream) return '#<lazy-list>';
  if(v instanceof LTree) return '#tree(' + lispStr(v.value) + (v.children.length ? ' ' + v.children.map(lispStr).join(' ') : '') + ')';
  return String(v);
}

// ---- 标准库（每次 newEnv 自动加载，使用语言自身编写，浏览器/Node 通用）----
const STDLIB = `
(define identity (lambda (x) x))
(define constantly (lambda (x) (lambda (_) x)))
(define compose (lambda (& fs) (lambda (x) (foldl (lambda (acc f) (f acc)) x (reverse fs)))))
(define partition (lambda (n xs) (if (null? xs) (list) (cons (take xs n) (partition n (drop xs n))))))
(define take-while (lambda (p xs) (if (or (null? xs) (not (p (car xs)))) (list) (cons (car xs) (take-while p (cdr xs))))))
(define drop-while (lambda (p xs) (if (or (null? xs) (not (p (car xs)))) xs (drop-while p (cdr xs)))))
(define sum (lambda (xs) (foldl + 0 xs)))
(define product (lambda (xs) (foldl * 1 xs)))
(define butlast (lambda (xs) (if (null? (cdr xs)) (list) (cons (car xs) (butlast (cdr xs))))))
(define remove (lambda (p xs) (filter (lambda (x) (not (p x))) xs)))
(define zipmap (lambda (ks vs) (foldl (lambda (d kv) (dict-set d (car kv) (car (cdr kv)))) (dict) (zip ks vs))))
(define frequencies (lambda (xs) (foldl (lambda (d x) (dict-set d x (+ (dict-get d x 0) 1))) (dict) xs)))
(define interpose (lambda (sep xs) (if (or (null? xs) (null? (cdr xs))) xs (cons (car xs) (cons sep (interpose sep (cdr xs)))))))
(define member? (lambda (x xs) (if (null? xs) #f (if (equal? x (car xs)) #t (member? x (cdr xs))))))
(define distinct (lambda (xs) (foldl (lambda (acc x) (if (member? x acc) acc (append acc (list x)))) (list) xs)))
`;
function bootstrapStdlib(env){
  const exprs = parseAll(STDLIB);
  for(const ex of exprs) resolveTail(ev(ex, env, true));
}

// ---- 对外 API ----
function newEnv(){ const e = makeEnv(null); setupBuiltins(e); bootstrapStdlib(e); return e; }
function srcLineAt(src, line){
  const parts = src.split('\n');
  return (line >= 1 && line <= parts.length) ? parts[line-1].trim() : '';
}
function run(src, env, filename){
  env = env || newEnv();
  activeFile = filename || null;
  const exprs = parseAll(src);
  let r = null;
  try {
    for(const e of exprs) r = resolveTail(ev(e, env, true));
  } catch(err){
    if(err && err.lisp){
      let msg = err.message;
      if(activeFile) msg = '[文件: ' + activeFile + '] ' + msg;
      if(err.line != null){
        const snip = srcLineAt(src, err.line);
        msg = '【行 ' + err.line + '】' + msg + (snip ? '\n    > ' + snip : '');
      }
      if(err.trace && err.trace.length){
        msg += '\n  调用栈:\n' + err.trace.slice().reverse()
          .map((s, i) => '    ' + i + ': ' + s).join('\n');
      }
      err.message = msg;
    }
    throw err;
  }
  return r;
}

window.Sibilant = { tokenize, parseAll, ev, run, newEnv, lispStr, Sym, qq };
