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
class Atom {                                          // 可变状态原子：唯余一个 value 字段
  constructor(v){ this.value = (v === undefined ? null : v); }
}
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

// 把 AST 中所有与 sym 同名的符号替换为 val（as-> 占位符展开用）
function QQ(v){ return [new Sym('quote'), v]; }
function substSym(form, sym, val){
  if(form instanceof Sym) return (form.name === sym.name) ? QQ(val) : form;
  if(Array.isArray(form)){ const r = []; for(const e of form) r.push(substSym(e, sym, val)); r.line = form.line; return r; }
  return form;
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
      // ---- ci279–ci303: 线程/绑定宏（特殊形式实现，便于 nil 短路与占位替换）----
      case 'when-let': {
        if(!Array.isArray(node[1]) || node[1].length < 2) throw lispError('when-let 需要 (名 表达式) 绑定', node);
        const b = node[1];
        const v = ev(b[1], env, false);
        if(v !== false && v !== null){
          const ne = makeEnv(env);
          ne.vars[b[0].name] = v;
          let r = null;
          for(let i = 2; i < node.length; i++) r = ev(node[i], ne, i === node.length - 1 ? tail : false);
          return r;
        }
        return null;
      }
      case 'if-let': {
        if(!Array.isArray(node[1]) || node[1].length < 2) throw lispError('if-let 需要 (名 表达式) 绑定', node);
        const b = node[1];
        const v = ev(b[1], env, false);
        const ne = makeEnv(env);
        ne.vars[b[0].name] = v;
        if(v !== false && v !== null){
          if(node.length > 2) return ev(node[2], ne, tail);   // 真分支（单表单）
          return null;
        }
        if(node.length > 3) return evalBodyTCO(node.slice(3), ne, tail);  // 假分支
        return null;
      }
      case 'doto': {
        if(node.length < 2) throw lispError('doto 需要至少一个表达式', node);
        const v = ev(node[1], env, false);
        for(let i = 2; i < node.length; i++){
          const f = node[i];
          const form = Array.isArray(f) ? [f[0], QQ(v), ...f.slice(1)] : [f, QQ(v)];
          ev(form, env, false);
        }
        return v;
      }
      case 'as->': {
        if(node.length < 3) throw lispError('as-> 需要 (expr 名 & forms)', node);
        const nameSym = node[2];
        if(!(nameSym instanceof Sym)) throw lispError('as-> 第二参数须为占位符号', node);
        let x = ev(node[1], env, false);
        for(let i = 3; i < node.length; i++){
          const form = substSym(node[i], nameSym, x);
          x = ev(form, env, false);
        }
        return x;
      }
      case 'some->': {
        let x = ev(node[1], env, false);
        for(let i = 2; i < node.length; i++){
          if(x === false || x === null) return null;
          const f = node[i];
          const form = Array.isArray(f) ? [f[0], QQ(x), ...f.slice(1)] : [f, QQ(x)];
          x = ev(form, env, false);
        }
        return x;
      }
      case 'some->>': {
        let x = ev(node[1], env, false);
        for(let i = 2; i < node.length; i++){
          if(x === false || x === null) return null;
          const f = node[i];
          const form = Array.isArray(f) ? [...f, QQ(x)] : [f, QQ(x)];
          x = ev(form, env, false);
        }
        return x;
      }
      case 'cond->': {
        if(node.length < 2) throw lispError('cond-> 需要初始表达式', node);
        let x = ev(node[1], env, false);
        for(let i = 2; i < node.length; i++){
          const clause = node[i];
          if(!Array.isArray(clause) || clause.length < 2) throw lispError('cond-> 子句须为 (测试 表单)', node);
          const test = ev(clause[0], env, false);
          if(test !== false && test !== null){
            const f = clause[1];
            const form = Array.isArray(f) ? [f[0], QQ(x), ...f.slice(1)] : [f, QQ(x)];
            x = ev(form, env, false);
          }
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
        let catchClause = null, finallyClause = null;
        for(let i = 1; i < node.length; i++){
          const c = node[i];
          if(Array.isArray(c) && c.length && c[0] instanceof Sym){
            if(c[0].name === 'catch' && !catchClause) catchClause = c;
            else if(c[0].name === 'finally' && !finallyClause) finallyClause = c;
          }
        }
        const body = [];
        for(let i = 1; i < node.length; i++){
          if(node[i] === catchClause || node[i] === finallyClause) break;
          body.push(node[i]);
        }
        let result, thrown = undefined;
        try {
          let r = null;
          for(const e of body) r = ev(e, env, false);
          result = r;
        } catch(err) {
          if(catchClause){
            const ne = makeEnv(env);
            ne.vars[catchClause[1].name] = (err && err.message) ? err.message : String(err);
            result = ev(catchClause[2], ne, false);
          } else {
            thrown = err;
          }
        }
        if(finallyClause){ for(let i = 1; i < finallyClause.length; i++) ev(finallyClause[i], env, false); }
        if(thrown) throw thrown;
        return result;
      }
      case 'assert': {
        const ok = ev(node[1], env, false);
        if(ok === false || ok === null){
          let msg = '断言失败';
          if(node.length > 2){
            const parts = [];
            for(let i = 2; i < node.length; i++) parts.push(lispStr(ev(node[i], env, false)));
            msg = parts.join(' ');
          }
          throw lispError('assert: ' + msg, node);
        }
        return true;
      }
      case 'defonce': {
        const target = node[1];
        if(!(target instanceof Sym)) throw lispError('defonce 需要符号名', node);
        if(envGet(env, target.name) !== undefined) return target;
        const val = ev(node[2], env, false);
        envSet(env, target.name, val);
        return target;
      }
      case 'declare': {
        for(let i = 1; i < node.length; i++){
          const s = node[i];
          // 注意：必须置为 null(nil) 而非 undefined——否则 envGet 无法区分
          // “已前向声明”和“未定义”，ev 会在求值时抛“未定义符号”。
          if(s instanceof Sym && envGet(env, s.name) === undefined) envSet(env, s.name, null);
        }
        return null;
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
  // ---- ci279–ci323: 新增特殊形式/谓词的文档 + 既有函数缺失文档补全（自省可观测性）----
  DOCS['when-let'] = '绑定宏：(when-let (名 表达式) 体 …) 先求值表达式，非 nil 时把名绑定到该值并求值体，否则返回 null。例 (when-let (x (car (list 1))) (+ x 1)) => 2';
  DOCS['if-let']   = '绑定宏：(if-let (名 表达式) 真分支 [假分支]) 非 nil 走真分支，否则走假分支。例 (if-let (x (member 2 (list 1 2))) x 0) => (2)';
  DOCS['doto']     = '线程副作用宏：(doto x (f a) (g)) 依次以 x 为第一参数调用各表单，返回 x。例 (doto (atom 0) (swap! + 1) (swap! + 2)) => #<atom>';
  DOCS['as->']     = '显式占位线程宏：(as-> expr 名 表单 …) 把 expr 绑定到名，在后续表单中把名的出现替换为当前值，返回末值。例 (as-> 5 x (+ x 1) (* x 2)) => 12';
  DOCS['some->']   = 'nil 短路线程宏：(some-> x (f) (g)) 用 -> 方式逐步线程，任一步为 nil 立即返回 nil。例 (some-> (list 1 2) rest first) => 2、(some-> () rest first) => ()';
  DOCS['some->>']  = 'nil 短路线程宏(尾插)：(some->> x (f) (g)) 用 ->> 方式线程，遇 nil 短路。例 (some->> 3 (list) (map inc)) => (4)';
  DOCS['cond->']   = '条件线程宏：(cond-> x (测试 表单) …) 每个测试为真时按 -> 方式应用表单，返回最终值。例 (cond-> 0 (#t (+ 1)) (#f (* 2))) => 1';
  DOCS['try']      = '异常捕获：(try 体 … (catch 变量 处理器) [(finally 清理)] )，finally 无论是否异常都会执行。';
  DOCS['assert']   = '断言：(assert 测试 [消息 …]) 测试为 nil/false 时抛出带消息的错误，否则返回 #t。';
  DOCS['defonce']  = '幂等定义：(defonce 名 表达式) 仅当名尚未定义时绑定，已定义则跳过（重复加载安全）。';
  DOCS['declare']  = '前向声明：(declare 名 …) 预先把名字置为未定义，便于互相递归引用而不必 letrec。';
  DOCS['atom?']    = '类型判定：(atom? x) 当 x 是由 atom 创建的原子时为真。';
  DOCS['reduce']   = '归约：用函数把列表累积为单个值：(reduce f init xs) 等价于 (foldl f init xs)。例 (reduce + 0 (list 1 2 3)) => 6';
  DOCS['reverse']  = '反转列表：(reverse xs) 返回反转后的新列表(不修改原列表)。例 (reverse (list 1 2 3)) => (3 2 1)';
  DOCS['last']     = '取列表最后一个元素；空列表返回 null。例 (last (list 1 2 3)) => 3';
  DOCS['flatten']  = '把任意嵌套列表拍平为一维列表：(flatten xs) 递归展开所有子列表。例 (flatten (quote (1 (2 (3))))) => (1 2 3)';
  DOCS['foldl']    = '从左折叠：(foldl f init xs) 以 init 为初值依次用 f 累积。例 (foldl + 0 (list 1 2 3)) => 6';
  DOCS['foldr']    = '从右折叠：(foldr f init xs) 以 init 为初值从右端累积。例 (foldr cons () (list 1 2 3)) => (1 2 3)';
  DOCS['map']      = '映射：对列表每个元素应用函数，返回新列表：(map f xs)。例 (map inc (list 1 2)) => (2 3)';
  DOCS['filter']   = '过滤：保留谓词为真的元素：(filter p xs)。例 (filter even? (list 1 2 3 4)) => (2 4)';
  DOCS['for-each'] = '遍历：(for-each f xs) 对每个元素调用 f（忽略返回值，仅副作用），返回 null。';
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
  // 基础列表访问器(与 car/cdr 互补，贴近常用 Lisp 习惯)
  def('first', (l)=> Array.isArray(l) ? (l[0] ?? null) : null, '取列表首元素；空列表/非列表返回空(())。例 (first (list 1 2 3)) => 1');
  def('second', (l)=> Array.isArray(l) ? (l[1] ?? null) : null, '取列表第 2 个元素；不足返回空(())。例 (second (list 1 2 3)) => 2');
  def('third', (l)=> Array.isArray(l) ? (l[2] ?? null) : null, '取列表第 3 个元素；不足返回空(())。例 (third (list 1 2 3)) => 3');
  def('rest', (l)=> Array.isArray(l) ? l.slice(1) : [], '返回除首元素外的其余列表(新列表)。例 (rest (list 1 2 3)) => (2 3)');
  def('butlast', (l)=> Array.isArray(l) ? l.slice(0, -1) : [], '返回除末元素外的其余列表(新列表)。例 (butlast (list 1 2 3)) => (1 2)');
  def('not-empty', (x)=> !(x===null || (Array.isArray(x) && x.length===0) || (typeof x==='string' && x.length===0)), '判定值是否非空(非空列表/非空字符串/其它非假值均为真)。例 (not-empty (list 1)) => #t、(not-empty (list)) => #f');
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
  def('empty?', (x)=> {
    if (x === null) return true;
    if (Array.isArray(x)) return x.length === 0;
    if (typeof x === 'string') return x.length === 0;
    if (x instanceof LSet) return x.len === 0;
    if (x instanceof Dict) return x.len === 0;
    return false;
  }, '判断是否为空：空列表(含 \'()) / 空字符串 / null / 空集合(set) / 空字典(dict) 均返回真。例 (empty? ()) => #t、(empty? "") => #t、(empty? (set)) => #t、(empty? (dict)) => #t、(empty? (list 1)) => #f');
  def('eq?', (a,b)=> a===b);
  def('equal?', (a,b)=> deepEqual(a,b));
  def('mod', (a,b)=> { if(b===0) throw lispError('mod: 除以零'); return ((a%b)+b)%b; });
  def('sqrt', (a)=> Math.sqrt(a));
  def('abs', (a)=> Math.abs(a));
  def('print', (...a)=> a.map(lispStr).join(' '));
  def('range', (a, b, step)=> {
    if(step === 0) throw lispError('range: step 不能为 0（否则无法推进序列）');
    if(b === undefined){ const r=[]; for(let i=0;i<a;i++) r.push(i); return r; }
    const st = (step === undefined) ? 1 : step;
    const r = [];
    if(st > 0){ for(let i=a; i<b; i+=st) r.push(i); }
    else if(st < 0){ for(let i=a; i>b; i+=st) r.push(i); }
    return r;
  }, '生成整数序列：(range n) 为 0..n-1；(range a b [step]) 从 a 起、步长 step（不可为 0）直到越过 b。例 (range 3) => (0 1 2)、(range 1 5 2) => (1 3)');
  def('length', (x)=> Array.isArray(x) ? x.length : (typeof x==='string' ? x.length : 0));
  def('map', (f,l)=> Array.isArray(l) ? l.map(x=>applyFn(f,[x])) : []);
  def('filter', (f,l)=> Array.isArray(l) ? l.filter(x=>applyFn(f,[x])) : []);
  // concat：连接多个序列（列表/单元素）为一个新列表；(concat (list 1 2) (list 3) 4) => (1 2 3 4)
  def('concat', (...ls)=> { const out = []; for(const x of ls){ if(Array.isArray(x)) out.push(...x); else if(x !== null && x !== undefined) out.push(x); } return out; }, '连接多个序列为一个新列表：列表展开并拼接，单元素直接追加。例 (concat (list 1 2) (list 3 4)) => (1 2 3 4)、(concat (list 1) 2) => (1 2)');
  def('reduce', (f,init,l)=> Array.isArray(l) ? l.reduce((a,x)=>applyFn(f,[a,x]), init) : init);
  // complement（谓词取反）：返回新谓词，调用 f 后对结果取逻辑非(Sibilant 中 false/null 视为假)。
  // 例 (filter (complement even?) (list 1 2 3)) => (1 3)
  def('complement', (f)=> (...args)=> { const r = applyFn(f, args); return (r === false || r === null); }, '返回谓词 f 的否定谓词：(complement f) 接受与 f 相同参数，调用 f 后对结果取逻辑非(Sibilant 中 false/null 视为假，其余为真)。常用于 (filter (complement pred) xs)。例 (filter (complement even?) (list 1 2 3)) => (1 3)');
  // scan（前缀累积 / reductions）：返回从 init 起、每步用 f 累积的列表（含初始值），长度 = len(xs)+1
  def('scan', (f, init, l)=>{
    if(!Array.isArray(l)) return [init];
    const r = [init]; let acc = init;
    for(const x of l){ acc = applyFn(f, [acc, x]); r.push(acc); }
    return r;
  }, '前缀累积(reductions)：(scan f init xs) 返回从 init 起每一步用 f 累积的结果列表(含初始值)，长度 = len(xs)+1；常用于生成前缀和/前缀积。例 (scan + 0 \'(1 2 3)) => (0 1 3 6)');
  def('apply', (f,l)=> {
    if(!Array.isArray(l)) throw lispError('apply 期望列表作为第二参数，得到: ' + lispStr(l));
    return applyFn(f, l);
  }, '把函数应用到参数列表：(apply f (list a b …)) 等价于 (f a b …)；第二参数必须是列表，否则报错。例 (apply + (list 1 2 3)) => 6');

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
  // ---- 通用容器工具：keys / vals / count / dissoc / str（多态于 dict/set/序列）----
  def('keys', (c)=> {
    if(c instanceof Dict) return c.keys();
    if(c instanceof LSet) return c.keys();
    if(Array.isArray(c)) { const r=[]; for(let i=0;i<c.length;i++) r.push(i); return r; }
    if(typeof c === 'string'){ const r=[]; for(let i=0;i<c.length;i++) r.push(i); return r; }
    throw lispError('keys 需要 dict/set/序列');
  }, '返回容器键集合：dict 返回键列表、set 返回元素、序列(列表/字符串)返回 0 基索引。例 (keys (dict (quote a) 1)) => (a)。');
  def('vals', (c)=> {
    if(c instanceof Dict) return c.vals();
    if(c instanceof LSet) return c.keys();
    if(Array.isArray(c)) return c.slice();
    if(typeof c === 'string') return c.split('');
    throw lispError('vals 需要 dict/set/序列');
  }, '返回容器值集合：dict 返回值列表、set 返回元素、列表返回其自身拷贝、字符串返回字符列表。例 (vals (dict (quote a) 1)) => (1)。');
  def('count', (c)=> {
    if(c instanceof Dict || c instanceof LSet) return c.len;
    if(Array.isArray(c) || typeof c === 'string') return c.length;
    if(c === null || c === undefined) return 0;
    return 1;
  }, '返回元素个数：dict/set 取元素数、列表/字符串取长度、nil 取 0、其他原子取 1。例 (count (list 1 2 3)) => 3。');
  def('dissoc', (d, ...ks)=> {
    if(!(d instanceof Dict) && !(d instanceof LSet)) throw lispError('dissoc 需要 dict/set');
    let r = d._clone();
    for(const k of ks) r = r.del(k);
    return r;
  }, '从 dict/set 中移除若干键，返回新容器(原容器不变)。例 (dissoc (dict (quote a) 1 (quote b) 2) (quote a)) => #{b 2}。');
  function _strOf(x){
    if(x === null || x === undefined) return '';
    if(typeof x === 'string') return x;
    if(typeof x === 'boolean') return x ? 'true' : 'false';
    if(typeof x === 'number') return String(x);
    if(Array.isArray(x)) return x.map(_strOf).join('');
    if(x instanceof Dict) return '{' + x.keys().map((k,i)=> _strOf(k) + ' ' + _strOf(x.vals()[i])).join(', ') + '}';
    if(x instanceof LSet) return '#{' + x.keys().map(_strOf).join(' ') + '}';
    return lispStr(x);
  }
  def('str', (...args)=> args.map(_strOf).join(''), '将任意参数拼接为字符串：nil 视为空串、布尔转 true/false、列表/字典/集合递归展开。例 (str "a" 1 (list 2 3)) => "a123"。');
  // ---- 可变状态原子（atom / deref / reset! / swap!）----
  def('atom', (v)=> new Atom(v), '创建可变状态原子(atom)，初始值为 v(nil 则取 null)。deref 取当前值、reset! 设值、swap! 以函数更新。例 (def a (atom 0)) (swap! a + 1) => 1。');
  def('deref', (a)=> (a instanceof Atom) ? a.value : (function(){ throw lispError('deref 需要 atom'); })(), '取原子当前值。');
  def('reset!', (a, v)=> { if(!(a instanceof Atom)) throw lispError('reset! 需要 atom'); a.value = v; return v; }, '将原子值重设为 v，返回 v。');
  def('swap!', (a, f, ...args)=> { if(!(a instanceof Atom)) throw lispError('swap! 需要 atom'); a.value = applyFn(f, [a.value, ...args]); return a.value; }, '以函数 f 更新原子：新值 = f(当前值, ...args)，返回新值。例 (swap! a + 1) 或 (swap! a (lambda (v) (* v 2)))。');
  def('atom?', (x)=> x instanceof Atom, '判断是否为状态原子(atom)：(atom? a) 当 a 由 atom 创建时为真。例 (atom? (atom 0)) => #t、(atom? 5) => #f');

  // 字典组合：合并 / 更新 / 嵌套取值
  def('merge', (d1, d2)=> {
    if(!(d1 instanceof Dict) || !(d2 instanceof Dict)) throw lispError('merge 需要两个 dict');
    let r = d1._clone();
    const ks = d2.keys(), vs = d2.vals();
    for(let i=0;i<ks.length;i++) r = r.put(ks[i], vs[i], false);
    return r;
  }, '合并两个 dict：返回新 dict，键取自 d1∪d2，冲突时 d2 胜出(后者覆盖前者)。例 (merge (dict (quote a) 1) (dict (quote b) 2)) => #{a 1 b 2}');
  def('update', (d, k, f)=> {
    if(!(d instanceof Dict)) throw lispError('update 需要 dict');
    const cur = d.has(k) ? d.get(k) : null;
    return d.put(k, applyFn(f, [cur]), false);
  }, '以函数 f 更新 dict 中键 k 的值：取当前值(无则 null)传给 f，结果写回，返回新 dict。例 (update (dict (quote x) 1) (quote x) (lambda (v) (+ v 10))) => #{x 11}');
  def('get-in', (coll, ks, defv)=> {
    if(!Array.isArray(ks)) return (defv===undefined) ? null : defv;
    let cur = coll;
    for(const k of ks){
      if(cur === null || cur === undefined) return (defv===undefined) ? null : defv;   // 路径提前断裂
      let found = false, nv = null;
      if(Array.isArray(cur)){ const i = (typeof k === 'number') ? k : Number(k); found = Number.isFinite(i) && i>=0 && i<cur.length; if(found) nv = cur[i]; }
      else if(cur instanceof Dict){ found = cur.has(k); if(found) nv = cur.get(k); }
      else return (defv===undefined) ? null : defv;                                // 非容器，无法继续下钻
      if(!found) return (defv===undefined) ? null : defv;                        // 键缺失 → 返回默认值
      cur = nv;
    }
    return cur;
  }, '按键序列 ks 在嵌套结构(dict / 数组)中逐层取值；任一路径缺失返回 null 或 defv(仅在键缺失/路径断裂时，值本身为 null 不触发默认)。例 (get-in (dict (quote a) (dict (quote b) 2)) (list (quote a) (quote b))) => 2');

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
  def('set-difference', (a, b)=> { if(!(a instanceof LSet) || !(b instanceof LSet)) throw lispError('set-difference 需要 set'); const r = new LSet(); for(const v of a.keys()) if(!b.has(v)) r.add(v, true); return r; }, '集合差集：(set-difference a b) 返回属于 a 但不属于 b 的元素组成的新集合（不可变，不改变入参）。例 (set-difference (set 1 2 3) (set 2 4)) => (set 1 3)');
  def('set-subset?', (a, b)=> { if(!(a instanceof LSet) || !(b instanceof LSet)) throw lispError('set-subset? 需要 set'); for(const v of a.keys()) if(!b.has(v)) return false; return true; }, '子集判定：(set-subset? a b) 当 a 的每一个元素都属于 b 时返回真（空集是任何集合的子集）。例 (set-subset? (set 1 2) (set 1 2 3)) => #t、(set-subset? (set 1 2) (set 1)) => #f');
  def('set-symmetric-difference', (a, b)=> { if(!(a instanceof LSet) || !(b instanceof LSet)) throw lispError('set-symmetric-difference 需要 set'); const r = new LSet(); for(const v of a.keys()) if(!b.has(v)) r.add(v, true); for(const v of b.keys()) if(!a.has(v)) r.add(v, true); return r; }, '对称差集：(set-symmetric-difference a b) 返回只属于 a 或只属于 b 的元素（即 (a-b) ∪ (b-a)）。例 (set-symmetric-difference (set 1 2 3) (set 2 3 4)) => (set 1 4)');

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
  def('gcd', (a, b)=> {
    if(!isFinite(Number(a)) || !isFinite(Number(b))) return null;
    let x = Math.abs(Math.trunc(Number(a))), y = Math.abs(Math.trunc(Number(b)));
    while(y){ const t = y; y = x % y; x = t; }
    return x;
  }, '最大公约数(非负整数)：(gcd a b) 返回 |a| 与 |b| 的最大公约数；非有限数输入返回 null。例 (gcd 12 18) => 6、(gcd -8 12) => 4、(gcd 0 7) => 7');
  def('lcm', (a, b)=> {
    if(!isFinite(Number(a)) || !isFinite(Number(b))) return null;
    const x = Math.trunc(Number(a)), y = Math.trunc(Number(b));
    if(x === 0 || y === 0) return 0;
    const g = (function gcd(u,v){ u=Math.abs(u); v=Math.abs(v); while(v){ const t=v; v=u%v; u=t; } return u; })(x, y);
    return Math.abs(x * y) / g;
  }, '最小公倍数(非负整数)：(lcm a b) 返回 |a| 与 |b| 的最小公倍数；任一为 0 返回 0；非有限数输入返回 null。例 (lcm 4 6) => 12、(lcm 0 5) => 0');
  def('divisors', (n)=> {
    const v = Math.trunc(Number(n));
    if(!isFinite(v) || v <= 0) return [];
    const out = [];
    for(let i = 1; i * i <= v; i++){ if(v % i === 0){ out.push(i); if(i !== v / i) out.push(v / i); } }
    return out.sort((x, y) => x - y);
  }, '正约数列表：(divisors n) 返回正整数 n 的所有正约数(升序)；非正整数返回空列表。例 (divisors 12) => (1 2 3 4 6 12)、(divisors 7) => (1 7)、(divisors -3) => ()');
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
  def('sum', (l)=> Array.isArray(l) ? l.reduce((a, x)=> a + (Number(x) || 0), 0) : 0, '数值列表求和：(sum xs) 将列表中每个元素当作数字相加(非数字按 0 处理)；空列表返回 0。例 (sum (list 1 2 3 4)) => 10');
  def('product', (l)=> Array.isArray(l) ? l.reduce((a, x)=> a * (Number(x) || 0), 1) : 1, '数值列表求积：(product xs) 将列表中每个元素当作数字连乘(非数字按 0 处理)；空列表返回 1。例 (product (list 2 3 4)) => 24');
  def('mean', (l)=> { if(!Array.isArray(l) || l.length === 0) return 0; const s = l.reduce((a,x)=> a + (Number(x)||0), 0); return s / l.length; }, '算术平均值：(mean xs) 返回数值列表的算术平均；空列表返回 0。例 (mean (list 1 2 3 4)) => 2.5');
  def('median', (l)=> { if(!Array.isArray(l) || l.length === 0) return 0; const a = l.map(x=>Number(x)||0).sort((p,q)=> p-q); const n = a.length, m = n>>1; return n % 2 ? a[m] : (a[m-1] + a[m]) / 2; }, '中位数：(median xs) 升序排序后取中间值；偶数个元素取中间两数的平均。例 (median (list 3 1 2)) => 2、(median (list 4 1 3 2)) => 2.5');
  def('variance', (l)=> { if(!Array.isArray(l) || l.length < 2) return 0; const a = l.map(x=>Number(x)||0); const m = a.reduce((s,x)=> s+x,0)/a.length; return a.reduce((s,x)=> s+(x-m)*(x-m),0)/(a.length-1); }, '样本方差（无偏，除以 n-1）：(variance xs) 返回数值列表的样本方差；元素不足 2 个返回 0。例 (variance (list 2 4 4 4 5 5 7 9)) ≈ 4.571');
  def('stdev', (l)=> Math.sqrt((Array.isArray(l) && l.length >= 2) ? (()=>{ const a=l.map(x=>Number(x)||0); const m=a.reduce((s,x)=>s+x,0)/a.length; return a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1); })() : 0), '样本标准差：(stdev xs) 即 (sqrt (variance xs))；元素不足 2 个返回 0。例 (stdev (list 2 4 4 4 5 5 7 9)) ≈ 2.138');
  def('clamp', (x, lo, hi)=> { const a = Number(x), b = Number(lo), c = Number(hi); if(!isFinite(a) || !isFinite(b) || !isFinite(c)) return null; return Math.min(Math.max(a, b), c); }, '将数值限制在闭区间 [lo, hi] 内：(clamp x lo hi) 当 x<lo 取 lo、x>hi 取 hi、否则取 x；任一参数非有限数时返回 null。例 (clamp 15 0 10) => 10、(clamp -3 0 10) => 0、(clamp "x" 0 10) => null');
  def('lerp', (a, b, t)=> { const x = Number(a), y = Number(b), u = Number(t); if(!isFinite(x) || !isFinite(y) || !isFinite(u)) return null; return x + (y - x) * u; }, '线性插值：(lerp a b t) 返回 a 与 b 按比例 t 插值的结果(等价于 a+(b-a)*t)；任一参数非有限数时返回 null。例 (lerp 0 10 0.5) => 5、(lerp 0 100 0.25) => 25');

  // ---- 字符串 ----
  def('string-append', (...a)=> a.map(x => typeof x==='string' ? x : lispStr(x)).join(''));
  def('substring', (s, i, j)=> String(s).slice(i, j));
  def('string-length', (s)=> String(s).length);
  def('string-upcase', (s)=> String(s).toUpperCase());
  def('string-downcase', (s)=> String(s).toLowerCase());
  def('string-trim', (s)=> String(s).trim());
  def('string-reverse', (s)=> String(s).split('').reverse().join(''));
  def('string-contains?', (s, sub)=> String(s).includes(String(sub)));
  def('string-split', (s, sep)=> String(s).split(sep === undefined ? /\s+/ : String(sep)), '按分隔符把字符串切成列表：(string-split s sep) sep 省略时按空白切分；sep 为字符串时按该串切分。例 (string-split "a,b,c" ",") => ("a" "b" "c")');
  def('string-join', (l, sep)=> Array.isArray(l) ? l.map(x => typeof x==='string'?x:lispStr(x)).join(String(sep||'')) : '');
  def('string-replace', (s, old, neu)=> { const o = String(old); if(o === '') return String(s); return String(s).split(o).join(String(neu)); }, '字符串替换：(string-replace s old neu) 将 s 中所有 old 子串替换为 neu；当 old 为空串时按无操作处理(返回原串，避免在每个字符间插入 neu 的意外行为)。例 (string-replace "a-b-c" "-" "/") => "a/b/c"');
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
        if(k + 1 >= s.length){ out += '~'; break; }   // 行尾单独的 ~ 视为字面量，避免输出 "undefined"
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
  }, '格式化字符串：~a=值字面量, ~s=原串, ~d=数字, ~%=换行, ~~=~, 行尾单独 ~ 视为字面量。例 (format "x=~a" 42) => "x=42"');

  // ---- 列表增强 ----
  def('list-ref', (l, i)=> Array.isArray(l) ? (i >= 0 && i < l.length ? l[i] : null) : null, '按索引取列表元素(0 基)；下标越界或为负返回 null（不再回绕到末尾）。例 (list-ref (list 1 2 3) 1) => 2、(list-ref (list 1) 5) => ()');
  def('reverse', (l)=> Array.isArray(l) ? l.slice().reverse() : []);
  def('take', (l, n)=> Array.isArray(l) ? l.slice(0, Math.max(0, n|0)) : [], '取列表前 n 个元素(新列表)；n 为负时按 0 处理。例 (take (list 1 2 3 4) 2) => (1 2)');
  def('nth', (l, i)=> Array.isArray(l) ? (i >= 0 && i < l.length ? l[i] : null) : null, '按索引取列表元素(0 基)；下标越界或为负返回 null（不应回绕到末尾）。例 (nth (list 1 2 3) 0) => 1、(nth (list 1 2 3) 9) => ()');
  // 序列工具补全：排序 / 切片 / 取尾 / 取末 / 扁平化 / 谓词聚合
  def('sort', (l, cmp)=> {
    if(!Array.isArray(l)) return [];
    const r = l.slice();
    if(cmp === undefined) r.sort((x,y)=> (x<y)?-1:(x>y)?1:0);
    else r.sort((x,y)=> { const v = applyFn(cmp,[x,y]); return (v===true||v>0)?-1:(v===false||v<0)?1:0; });
    return r;
  });
  def('sort-by', (f, l)=> {
    if(!Array.isArray(l)) return [];
    const r = l.slice();
    r.sort((x,y)=> { const kx = applyFn(f, [x]), ky = applyFn(f, [y]); return (kx<ky)?-1:(kx>ky)?1:0; });
    return r;
  }, '按键函数 f 的返回值对列表升序排序，返回新列表(原列表不变)。例 (sort-by (lambda (x) (mod x 3)) (list 3 1 2)) => (3 1 2)');
  def('partition', (n, l)=> {
    if(!Array.isArray(l)) return [];
    const size = Math.max(1, n|0);
    const out = [];
    for(let i=0;i<l.length;i+=size) out.push(l.slice(i, i+size));
    return out;
  }, '将列表每 n 个切分为一组子列表(末组不足 n 也保留)。例 (partition 2 (list 1 2 3 4 5)) => ((1 2) (3 4) (5))');
  def('reductions', (f, init, l)=> {
    if(!Array.isArray(l)) return [];
    const out = [init];
    let acc = init;
    for(const x of l){ acc = applyFn(f, [acc, x]); out.push(acc); }
    return out;
  }, '前缀归约(scanl)：以 init 为初值，依次用 f 累积，返回含初值的每一步结果列表。例 (reductions + 0 (list 1 2 3)) => (0 1 3 6)');
  def('interpose', (sep, l)=> {
    if(!Array.isArray(l)) return [];
    const out = [];
    for(let i=0;i<l.length;i++){ if(i>0) out.push(sep); out.push(l[i]); }
    return out;
  }, '在列表相邻元素间插入 sep。例 (interpose 0 (list 1 2 3)) => (1 0 2 0 3)');
  def('iterate', (f, x, n)=> {
    const cnt = (typeof n === 'number' && n >= 0) ? n : 0;
    const out = [];
    let cur = x;
    for(let i=0;i<cnt;i++){ out.push(cur); cur = applyFn(f, [cur]); }
    return out;
  }, '从 x 出发对 f 迭代 n 次，返回 n 个元素的序列(含初值)。例 (iterate (lambda (v) (* v 2)) 1 4) => (1 2 4 8)');
  def('some', (pred, l)=> {
    if(!Array.isArray(l)) return false;
    for(const x of l){ const v = applyFn(pred, [x]); if(v !== false && v !== null) return x; }
    return false;
  }, '返回列表中首个使 pred 为真的元素值；全为假则返回 #f。例 (some even? (list 1 3 4)) => 4、(some odd? (list 2 4)) => #f');
  // every?：所有元素满足谓词则 #t，否则 #f（空列表恒真）
  def('every?', (pred, l)=> {
    if(!Array.isArray(l)) return true;
    for(const x of l){ const v = applyFn(pred, [x]); if(v === false || v === null) return false; }
    return true;
  }, '判定列表中所有元素是否满足谓词 pred（空列表恒为真）；任一为假则返回 #f。例 (every? even? (list 2 4)) => #t、(every? even? (list 2 3)) => #f');
  def('not-every?', (pred, l)=> {
    if(!Array.isArray(l)) return false;
    for(const x of l){ const v = applyFn(pred, [x]); if(v === false || v === null) return true; }
    return false;
  }, 'every? 的否定：存在元素不满足 pred 时返回 #t（空列表为 #f）。例 (not-every? even? (list 2 3)) => #t');
  def('drop', (l, n)=> Array.isArray(l) ? l.slice(Math.max(0, n|0)) : [], '丢弃列表前 n 个元素，返回剩余(新列表)；n 为负时按 0 处理。例 (drop (list 1 2 3 4) 2) => (3 4)');
  def('last', (l)=> (Array.isArray(l) && l.length) ? l[l.length-1] : null);
  def('flatten', (l)=> {
    const out = [];
    const walk = (x)=>{ if(Array.isArray(x)) x.forEach(walk); else out.push(x); };
    if(Array.isArray(l)) l.forEach(walk);
    return out;
  }, '展平(递归)：将嵌套列表递归展平为单层列表；非列表输入返回空列表(与 flatten-deep 一致)。例 (flatten (list 1 (list 2 3))) => (1 2 3)、(flatten 5) => ()');
  // ---- 列表查询 / 聚合工具 ----
  def('find', (f, l)=> {
    if(!Array.isArray(l)) return null;
    for(const x of l){ const v = applyFn(f, [x]); if(v !== false && v !== null) return x; }
    return null;
  }, '返回列表中首个使谓词 f 为真(非 false/null)的元素；未找到返回 null。例 (find even? (list 1 3 4)) => 4');
  def('find-index', (f, l)=> {
    if(!Array.isArray(l)) return null;
    for(let i=0; i<l.length; i++){ const v = applyFn(f, [l[i]]); if(v !== false && v !== null) return i; }
    return null;
  }, '返回列表中首个使谓词 f 为真的元素下标；未找到返回 null。例 (find-index even? (list 1 3 4)) => 2');
  def('distinct', (l)=> {
    if(!Array.isArray(l)) return [];
    const seen = [], out = [];
    for(const x of l){ if(!seen.some(s => deepEqual(s, x))){ seen.push(x); out.push(x); } }
    return out;
  }, '去重：保留首次出现顺序，用 deepEqual 判定相等。例 (distinct (list 1 1 2 3 2)) => (1 2 3)');
  def('frequencies', (l)=> {
    const m = {}, out = [];
    if(Array.isArray(l)) for(const x of l){ const k = JSON.stringify(x); m[k] = (m[k] || 0) + 1; }
    for(const k in m){ out.push([JSON.parse(k), m[k]]); }
    return out;
  }, '统计各元素出现次数，返回计数 dict #{元素 次数 ...}（插入序，可用 dict-keys/dict-get 读取）。例 (frequencies (list 1 1 2)) => #{1 2 2 1}');
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

  // ---- 序列分组/切分工具 ----
  // 按 f(x) 的分组键把列表分组，返回 dict(键=分组键, 值=同组元素列表, 保持原序)
  def('group-by', (f, l)=> {
    const m = new Map();   // 保持插入序(整数键也要保序，故不用普通对象)
    if(Array.isArray(l)) for(const x of l){ const k = applyFn(f, [x]); const kk = JSON.stringify(k); const arr = m.get(kk); if(arr) arr.push(x); else m.set(kk, [x]); }
    let d = new Dict();
    for(const [kk, arr] of m) d = d.put(JSON.parse(kk), arr, false);   // Dict 不可变：put 返回新 dict，需重新赋值
    return d;
  }, '按 f(x) 的分组键把列表分组，返回 dict(键=分组键, 值=同组元素列表, 保持原序)。例 (group-by even? (list 1 2 3 4)) => #{#f (1 3) #t (2 4)}');
  // 把列表按「相邻且 f 值相等」切成若干段(返回段的列表)
  def('partition-by', (f, l)=> {
    if(!Array.isArray(l)) return [];
    const out = []; let run = [], key = null, started = false;
    for(const x of l){
      const k = applyFn(f, [x]);
      if(!started){ started = true; key = k; run = [x]; }
      else if(deepEqual(k, key)){ run.push(x); }
      else { out.push(run); run = [x]; key = k; }
    }
    if(run.length) out.push(run);
    return out;
  }, '把列表按「相邻且 f 值相等」切成若干段(返回段的列表)。例 (partition-by even? (list 1 2 4 3 5)) => ((1) (2 4) (3 5))');
  // 把列表在「首个不满足 f 的位置」切成两段(返回两段组成的列表)
  def('split-with', (f, l)=> {
    if(!Array.isArray(l)) return [[], []];
    let i = 0;
    for(; i < l.length; i++){ const v = applyFn(f, [l[i]]); if(v === false || v === null) break; }
    return [l.slice(0, i), l.slice(i)];
  }, '把列表在「首个不满足 f 的位置」切成两段(返回两段组成的列表)。例 (split-with pos? (list 1 2 -1 3)) => ((1 2) (-1 3))');
  // 交错合并多个列表(按索引轮流取，先到先止)
  def('interleave', (...lsts)=> {
    const arrs = lsts.filter(Array.isArray);
    if(arrs.length === 0) return [];
    const out = []; let any = true;
    for(let i = 0; any; i++){ any = false; for(const a of arrs){ if(i < a.length){ out.push(a[i]); any = true; } } }
    return out;
  }, '交错合并多个列表(按索引轮流取)。例 (interleave (list 1 2) (list 3 4 5)) => (1 3 2 4 5)');

  // ---- 列表谓词切片 / 扁平化 ----
  def('take-while', (f, l)=> {
    if(!Array.isArray(l)) return [];
    const out = [];
    for(const x of l){ const v = applyFn(f, [x]); if(v === false || v === null) break; out.push(x); }
    return out;
  }, '从列表头部取元素，直到首个使谓词 f 为假(或空)为止(含该元素前所有)。例 (take-while pos? (list 1 2 -1 3)) => (1 2)');
  def('drop-while', (f, l)=> {
    if(!Array.isArray(l)) return [];
    let i = 0;
    for(; i < l.length; i++){ const v = applyFn(f, [l[i]]); if(v === false || v === null) break; }
    return l.slice(i);
  }, '丢弃列表头部使谓词 f 为真的元素，返回首个使 f 为假处及之后的剩余。例 (drop-while pos? (list 1 2 -1 3)) => (-1 3)');
  def('mapcat', (f, l)=> {
    if(!Array.isArray(l)) return [];
    const out = [];
    for(const x of l){ const r = applyFn(f, [x]); if(Array.isArray(r)) for(const y of r) out.push(y); }
    return out;
  }, '对每个元素应用 f，把返回的列表依次拼接(flatMap)。例 (mapcat (lambda (x) (list x x)) (list 1 2)) => (1 1 2 2)');
  def('split-at', (n, l)=> {
    if(!Array.isArray(l)) return [[], []];
    const i = Math.max(0, n | 0);
    return [l.slice(0, i), l.slice(i)];
  }, '在索引 n 处把列表切成前后两段(返回两段组成的列表)。例 (split-at 2 (list 1 2 3 4)) => ((1 2) (3 4))');
  // ---- 集合/序列补充：子序列、函数式替换、配对、成员、追加、键筛选、带组合合并、字符串切分 ----
  def('subvec', (coll, start, end)=> {
    if(!Array.isArray(coll)) return [];
    const s = Math.max(0, start | 0);
    if(end === undefined || end === null) return coll.slice(s);
    return coll.slice(s, Math.max(s, end | 0));
  }, '取子向量：(subvec coll start [end]) 返回索引 [start,end) 的新列表(不含 end)。例 (subvec (list 1 2 3 4 5) 1 3) => (2 3)');
  def('replace', (coll, idx, val)=> {
    if(!Array.isArray(coll)) return [];
    const i = idx | 0;
    const out = coll.slice();
    if(i >= 0 && i < out.length) out[i] = val;
    return out;
  }, '函数式替换：(replace coll idx val) 返回新列表，仅把索引 idx 处元素改为 val(原列表不变)；索引越界则原样返回副本。例 (replace (list 1 2 3) 1 9) => (1 9 3)');
  def('zipmap', (keys, vals)=> {
    const d = new Dict();
    if(!Array.isArray(keys) || !Array.isArray(vals)) return d;
    const n = Math.min(keys.length, vals.length);
    for(let i = 0; i < n; i++) d.put(keys[i], vals[i], true);
    return d;
  }, '将两个等长列表按位配对成 dict：键取自 keys，值取自 vals(以较短者为准)。例 (zipmap (list (quote a) (quote b)) (list 1 2)) => #{a 1 b 2}');
  def('contains?', (coll, x)=> {
    if(Array.isArray(coll)) return coll.some(e => lispStr(e) === lispStr(x));
    if(coll instanceof Dict) return coll.has(x);
    if(coll instanceof LSet) return coll.has(x);
    if(typeof coll === 'string') return String(coll).includes(String(x));
    return false;
  }, '成员判定：(contains? coll x) 对数组按值(等号语义)、dict/set 按键、字符串按子串返回真。例 (contains? (list 1 2 3) 2) => #t');
  def('conj', (coll, x)=> {
    if(Array.isArray(coll)) return [...coll, x];
    if(coll instanceof Dict){ if(Array.isArray(x) && x.length >= 2) return coll.put(x[0], x[1], false); return coll; }
    if(coll instanceof LSet) return coll.add(x, false);
    return [x];
  }, '追加元素：(conj coll x) 对数组返回末尾追加 x 的新列表；对 dict 以 [k v] 形式写入；对 set 加入 x。例 (conj (list 1 2) 3) => (1 2 3)');
  def('select-keys', (m, ks)=> {
    const d = new Dict();
    if(!(m instanceof Dict) || !Array.isArray(ks)) return d;
    for(const k of ks){ if(m.has(k)) d.put(k, m.get(k), true); }
    return d;
  }, '只保留指定键：(select-keys m ks) 返回新 dict，仅含 ks 中且存在于 m 的键。例 (select-keys (dict (quote a) 1 (quote b) 2) (list (quote a))) => #{a 1}');
  def('merge-with', (f, d1, d2)=> {
    if(!(d1 instanceof Dict) || !(d2 instanceof Dict)) throw lispError('merge-with 需要两个 dict');
    let r = d1._clone();
    const ks = d2.keys(), vs = d2.vals();
    for(let i = 0; i < ks.length; i++){
      if(r.has(ks[i])) r = r.put(ks[i], applyFn(f, [r.get(ks[i]), vs[i]]), false);
      else r = r.put(ks[i], vs[i], false);
    }
    return r;
  }, '带组合函数的合并：(merge-with f d1 d2) 冲突键用 (f 旧值 新值) 合并，其余直接覆盖，返回新 dict。例 (merge-with + (dict (quote a) 1) (dict (quote a) 2)) => #{a 3}');
  def('split', (s, sep)=> String(s).split(sep == null ? /\s+/ : String(sep)), '按分隔符把字符串切成列表：sep 省略时按空白切分。例 (split "a,b,c" ",") => (a b c)');
  // ---- 字符/字符串补充：码点互转、大小写、左右裁剪 ----
  def('char-code', (ch)=> { const s = String(ch); return s.length ? s.charCodeAt(0) : 0; }, '取字符的 Unicode 码点(取字符串首字符)。例 (char-code "A") => 65');
  def('code-char', (n)=> { const v = n | 0; return (v >= 0 && v <= 0x10FFFF) ? String.fromCodePoint(v) : ''; }, '由 Unicode 码点还原字符。例 (code-char 65) => "A"');
  def('capitalize', (s)=> { const t = String(s); return t.length ? t[0].toUpperCase() + t.slice(1).toLowerCase() : ''; }, '首字母大写、其余小写。例 (capitalize "hELLo") => "Hello"');
  def('string-triml', (s)=> String(s).replace(/^\s+/, ''), '去除左侧(开头)空白。例 (string-triml "  ab") => "ab"');
  def('string-trimr', (s)=> String(s).replace(/\s+$/, ''), '去除右侧(结尾)空白。例 (string-trimr "ab  ") => "ab"');
  // ---- 集合/序列补充：超集判定、全互异判定、函数并置、带索引保留 ----
  def('superset?', (a, b)=> {
    const ta = (a instanceof LSet) ? 'set' : Array.isArray(a) ? 'list' : null;
    const tb = (b instanceof LSet) ? 'set' : Array.isArray(b) ? 'list' : null;
    if(ta === null || tb === null || ta !== tb) throw lispError('superset? 需要同为 set 或同为 list');
    const A = (a instanceof LSet) ? a.keys() : a;
    const B = (b instanceof LSet) ? b.keys() : b;
    const aset = new Set(A.map(e => lispStr(e)));
    return B.every(x => aset.has(lispStr(x)));
  }, '超集判定(多态)：(superset? a b) 当 b 的每个元素都属于 a 时为真；支持 set 与 list 同类型比较，空集是任意集合超集。例 (superset? (list 1 2 3) (list 2)) => #t、(superset? (set 1 2 3) (set 2)) => #t');
  const _collElems = (c)=> (c instanceof LSet) ? c.keys() : (Array.isArray(c) ? c : null);
  def('disjoint?', (a, b)=> {
    const A = _collElems(a), B = _collElems(b);
    if(A === null || B === null) return false;
    const bset = new Set(B.map(e => lispStr(e)));
    return !A.some(x => bset.has(lispStr(x)));
  }, '不相交判定(支持 set/list)：(disjoint? a b) 当 a 与 b 没有公共元素时为真。例 (disjoint? (list 1 2) (list 3 4)) => #t、(disjoint? (set 1 2) (set 2 3)) => #f');
  def('symmetric-diff', (a, b)=> {
    const A = _collElems(a), B = _collElems(b);
    if(A === null || B === null) return [];
    const aset = new Set(A.map(e => lispStr(e)));
    const bset = new Set(B.map(e => lispStr(e)));
    const out = [], seen = new Set();
    const push = x => { const k = lispStr(x); if(!seen.has(k)){ seen.add(k); out.push(x); } };
    for(const x of A) if(!bset.has(lispStr(x))) push(x);
    for(const x of B) if(!aset.has(lispStr(x))) push(x);
    return out;
  }, '对称差(支持 set/list)：(symmetric-diff a b) 返回属于 a 或 b 但不属于交集的元素(去重, 先 a 后 b 顺序)。例 (symmetric-diff (list 1 2 3) (list 2 3 4)) => (1 4)、(symmetric-diff (set 1 2 3) (set 2 3 4)) => (1 4)');
  def('distinct?', (l)=> { if(!Array.isArray(l)) return true; const seen = new Set(); for(const e of l){ const k = lispStr(e); if(seen.has(k)) return false; seen.add(k); } return true; }, '判断是否全元素互异(无重复)。例 (distinct? (list 1 2 3)) => #t、(distinct? (list 1 1 2)) => #f');
  // ---- 高阶序列/谓词组合补充 ----
  def('distinct-by', (f, l)=> {
    if(!Array.isArray(l)) return [];
    const seen = new Set(); const out = [];
    for(const e of l){ const k = lispStr(applyFn(f, [e])); if(!seen.has(k)){ seen.add(k); out.push(e); } }
    return out;
  }, '按键函数去重：(distinct-by f coll) 保留每个 (f 元素) 首次出现的元素。例 (distinct-by (lambda (x) (mod x 3)) (list 1 2 3 4 5)) => (1 2 3)');
  def('some-fn', (...fns)=> (x)=> {
    for(const f of fns){ const r = applyFn(f, [x]); if(r !== false && r !== null) return true; }
    return false;
  }, '谓词析取：(some-fn p1 p2 …) 返回新谓词，参数 x 只要任一 pi(x) 为真(非 false/null)即返回 #t。例 (filter (some-fn even? pos?) (list -2 -1 0 1)) => (-2 0 1)');
  def('every-pred', (...fns)=> (x)=> {
    for(const f of fns){ const r = applyFn(f, [x]); if(r === false || r === null) return false; }
    return true;
  }, '谓词合取：(every-pred p1 p2 …) 返回新谓词，仅当全部 pi(x) 为真时返回 #t。例 (filter (every-pred pos? even?) (list 1 2 3 4)) => (2 4)');
  // ---- 列表首/栈/拼接/循环补充 ----
  def('peek', (l)=> (Array.isArray(l) && l.length) ? l[0] : null, '取列表首元素(栈顶)，空列表返回 null。例 (peek (list 1 2 3)) => 1');
  def('pop', (l)=> Array.isArray(l) ? l.slice(1) : [], '弹出列表首元素，剩余为新列表(栈 pop)。例 (pop (list 1 2 3)) => (2 3)');
  def('list*', (...args)=> {
    if(args.length === 0) return [];
    const init = args.slice(0, -1);
    const last = args[args.length - 1];
    const tail = Array.isArray(last) ? last : [last];
    return init.concat(tail);
  }, '拼接列表(末参为序列则展开)：除最后一个参数外逐个作为元素，最后一个参数若为列表则展开拼接。例 (list* 1 2 (list 3 4)) => (1 2 3 4)、(list* (list 1 2)) => (1 2)');
  def('rotate', (n, l)=> {
    if(!Array.isArray(l)) return [];
    const len = l.length;
    if(len === 0) return [];
    const k = ((n|0) % len + len) % len;
    return l.slice(k).concat(l.slice(0, k));
  }, '循环左移：(rotate n l) 把列表向左循环移动 n 位(负数右移)。例 (rotate 1 (list 1 2 3 4)) => (2 3 4 1)、(rotate -1 (list 1 2 3 4)) => (4 1 2 3)');
  def('juxt', (...fs)=> (...args)=> fs.map(f => applyFn(f, args)), '将多个函数并置为一个函数：调用时返回各函数作用于同一参数的结果列表。例 ((juxt inc dec) 5) => (6 4)');
  // ---- 高阶函数补充：fnil / trampoline ----
  // fnil：返回 f 的包装，调用时把为 nil(null/undefined) 的前 N 个参数替换为对应默认值
  // (fnil f d0 d1 ...) => (...args) => f(第 i 个为 nil 时取 di)
  def('fnil', (f, ...defaults) => (...args) => {
    const a = args.slice();
    for(let i = 0; i < defaults.length && i < a.length; i++){ if(a[i] == null || (Array.isArray(a[i]) && a[i].length === 0)) a[i] = defaults[i]; }
    return applyFn(f, a);
  }, '为 nil 参数提供默认值的高阶函数：(fnil f d0 d1 ...) 返回 f 的包装函数，调用时把前若干位置上的 nil（null / 空列表 ()）参数替换为对应默认值。例 ((fnil + 1) () 2) => 3、((fnil str "x") ()) => "x"');
  // trampoline：避免深度尾递归爆栈——反复调用返回的函数(thunk)直到得到非函数值
  // (trampoline f & args) => 先 applyFn(f, args)；若结果是函数则继续调用之，直到返回非函数值
  def('trampoline', (f, ...args) => {
    let r = applyFn(f, args);
    let steps = 0;
    while(r && r.__lambda && steps < 1000000){ r = applyFn(r, []); steps++; }
    return r;
  }, '蹦床：避免尾递归爆栈。(trampoline f & args) 先调用 f(args)，若结果是函数(闭包)则继续调用之(无参)，重复直到返回非函数值。例 (trampoline (lambda (n) (if (= n 0) 0 (lambda () (... (dec n)))))) 0');
  // ---- 符号 introspection：name / namespace ----
  def('name', (x)=> (x instanceof Sym) ? x.name : (typeof x === 'string' ? x : null), '取名字：符号返回其名称字符串，字符串原样返回，其余返回 null。例 (name (quote foo)) => "foo"、(name "bar") => "bar"、(name 5) => null');
  def('namespace', (x)=> { if(!(x instanceof Sym)) return ''; const i = x.name.indexOf('/'); return i >= 0 ? x.name.slice(0, i) : ''; }, '取命名空间：符号名以 / 分隔时返回 / 之前部分，无命名空间返回空串。例 (namespace (quote a/b)) => "a"、(namespace (quote foo)) => ""');
  def('keep-indexed', (f, l)=> {
    if(!Array.isArray(l)) return [];
    const out = [];
    for(let i = 0; i < l.length; i++){ if(applyFn(f, [i, l[i]])) out.push(l[i]); }
    return out;
  }, '保留索引谓词为真的元素：(keep-indexed f l) 对每个 (index element) 应用 f，保留为真者。例 (keep-indexed (lambda (i x) (= i 0)) (list 1 2 3)) => (1)');
  def('inc', (x)=> x + 1, '返回 x+1。例 (inc 4) => 5');
  def('dec', (x)=> x - 1, '返回 x-1。例 (dec 4) => 3');
  // ---- 随机 / 解析 / 输出 / 集合关系补充 ----
  def('every', (f, l)=> { if(!Array.isArray(l)) return false; for(const e of l) if(!applyFn(f, [e])) return false; return true; }, '全称量词：(every pred coll) 当 coll 中每个元素都满足 pred 时返回真(空集为真)。例 (every pos? (list 1 2 3)) => #t');
  def('rand', ()=> Math.random(), '返回 [0,1) 区间的伪随机浮点数。例 (rand) 形如 0.37…');
  def('rand-int', (n)=> Math.floor(Math.random() * Math.max(0, n|0)), '返回 [0,n) 区间的伪随机整数。例 (rand-int 10) 落在 0..9');
  // ---- 随机辅助 ----
  def('rand-nth', (coll)=> {
    let arr;
    if(Array.isArray(coll)) arr = coll;
    else if(coll instanceof LSet) arr = [...coll.keys()];
    else if(coll instanceof Dict) arr = coll.keys().map(k => [k, coll.get(k)]);
    else return null;
    if(arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }, '从集合中随机取一个元素：(rand-nth coll) 对 list/set/dict 随机返回其中之一，空集合返回 null。例 (rand-nth (list 1 2 3)) 落在 1/2/3 之一');
  def('shuffle', (coll)=> {
    let arr;
    if(Array.isArray(coll)) arr = coll.slice();
    else if(coll instanceof LSet) arr = [...coll.keys()];
    else if(coll instanceof Dict) arr = coll.keys().map(k => [k, coll.get(k)]);
    else return [];
    for(let i = arr.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }, '随机重排集合(返回新列表，不改原集合)：(shuffle coll) 对 list/set/dict 做 Fisher–Yates 洗牌。例 (shuffle (list 1 2 3)) 为 (1 2 3) 的某种排列');
  def('repeatedly', (n, f)=> {
    const k = Math.max(0, n|0); const out = [];
    for(let i = 0; i < k; i++) out.push(applyFn(f, [], null));
    return out;
  }, '重复调用：返回 (f) 连续 n 次的调用结果列表。例 (repeatedly 3 (fn [] 7)) => (7 7 7)；(repeatedly 3 (fn [] (rand-int 10))) 为 3 个随机整数');
  def('parse-int', (s, radix)=> { const r = radix == null ? 10 : (radix|0); const v = parseInt(String(s), r); return isNaN(v) ? null : v; }, '把字符串解析为整数(可选进制 radix，默认 10)，失败返回 null。例 (parse-int "42") => 42、(parse-int "1010" 2) => 10');
  def('parse-float', (s)=> { const v = parseFloat(String(s)); return isNaN(v) ? null : v; }, '把字符串解析为浮点数，失败返回 null。例 (parse-float "3.14") => 3.14');
  def('pr-str', (...a)=> a.map(lispStr).join(' '), '把任意值渲染成 Sibilant 字面量字符串(与打印格式一致)。例 (pr-str (list 1 2)) => "(1 2)"');
  def('prn', (...a)=> { console.log(a.map(lispStr).join(' ')); return null; }, '打印各参数的字面量形式并换行，返回 null(副作用函数)。例 (prn "hi" 1) 输出 hi 1');
  def('subset?', (a, b)=> {
    const ta = (a instanceof LSet) ? 'set' : Array.isArray(a) ? 'list' : null;
    const tb = (b instanceof LSet) ? 'set' : Array.isArray(b) ? 'list' : null;
    if(ta === null || tb === null || ta !== tb) throw lispError('subset? 需要同为 set 或同为 list');
    const A = (a instanceof LSet) ? a.keys() : a;
    const B = (b instanceof LSet) ? b.keys() : b;
    const bset = new Set(B.map(e => lispStr(e)));
    return A.every(x => bset.has(lispStr(x)));
  }, '子集判定(多态)：(subset? a b) 当 a 的每个元素都出现在 b 中时为真；支持 set 与 list 同类型比较，空集是任意集合子集；混合/非集合输入抛错。例 (subset? (list 1 2) (list 1 2 3)) => #t、(subset? (set 1) (set 1 2)) => #t');
  const _collToEntries = coll => {
    const m = new Map();
    if(coll instanceof LSet){ for(const e of coll.keys()) m.set(lispStr(e), e); }
    else if(Array.isArray(coll)){ for(const e of coll) m.set(lispStr(e), e); }
    return m;
  };
  def('intersection', (a, b)=> { const A = _collToEntries(a), B = _collToEntries(b); const out = []; for(const [k, v] of A) if(B.has(k)) out.push(v); return out; }, '集合交集：(intersection a b) 返回同时属于两集合的元素组成的列表(按 a 顺序、去重)。例 (intersection (list 1 2 3) (list 2 3 4)) => (2 3)');
  def('union', (a, b)=> { const seen = new Map(); const add = c => { const m = _collToEntries(c); for(const [k, v] of m) seen.set(k, v); }; add(a); add(b); return [...seen.values()]; }, '集合并集：(union a b) 返回两集合所有元素组成的去重列表。例 (union (list 1 2) (list 2 3)) => (1 2 3)');
  def('difference', (a, b)=> { const A = _collToEntries(a), B = _collToEntries(b); const out = []; for(const [k, v] of A) if(!B.has(k)) out.push(v); return out; }, '集合差集：(difference a b) 返回属于 a 但不属于 b 的元素列表。例 (difference (list 1 2 3) (list 2)) => (1 3)');
  def('sym-diff', (a, b)=> { const A = _collToEntries(a), B = _collToEntries(b); const out = []; for(const [k, v] of A) if(!B.has(k)) out.push(v); for(const [k, v] of B) if(!A.has(k)) out.push(v); return out; }, '对称差集：(sym-diff a b) 返回仅属于其中一个集合的元素列表。例 (sym-diff (list 1 2) (list 2 3)) => (1 3)');
  // ---- 集合构造 / 类型 / 数值补充 ----
  def('empty', (coll)=> { if(Array.isArray(coll)) return []; if(coll instanceof LSet) return new LSet(); if(coll instanceof Dict) return new Dict(); return []; }, '返回同类型空集合：(empty coll) list→[]、set→空set、dict→空dict。例 (empty (list 1 2)) => ()');
  def('type', (x)=> { if(x === null || x === undefined) return 'null'; if(typeof x === 'boolean') return 'bool'; if(typeof x === 'number') return 'number'; if(typeof x === 'string') return 'string'; if(Array.isArray(x)) return 'list'; if(x instanceof Dict) return 'dict'; if(x instanceof LSet) return 'set'; return (x && x._isFn) ? 'fn' : typeof x; }, '返回值的类型名：null/bool/number/string/list/dict/set/fn。例 (type 5) => "number"、(type (list)) => "list"');
  def('vec', (coll)=> { if(Array.isArray(coll)) return coll.slice(); if(coll instanceof LSet) return [...coll.keys()]; if(coll instanceof Dict) return coll.keys().map(k => [k, coll.get(k)]); if(coll == null) return []; return [coll]; }, '将集合转为向量(列表)：(vec s) 对 list 返回副本、set/dict 返回其元素列表。例 (vec (set 1 2)) => (1 2)');
  def('into', (to, from)=> {
    if(Array.isArray(to)){
      if(Array.isArray(from)) return to.concat(from);
      if(from instanceof LSet) return to.concat([...from.keys()]);
      if(from instanceof Dict) return to.concat(from.keys().map(k => [k, from.get(k)]));
      return to;
    }
    if(to instanceof Dict){
      let d = to;
      const addPair = kv => { if(Array.isArray(kv) && kv.length >= 2) d = d.put(kv[0], kv[1], false); };
      if(Array.isArray(from)) from.forEach(addPair);
      else if(from instanceof Dict){ for(const k of from.keys()) d = d.put(k, from.get(k), false); }
      else if(from instanceof LSet){ for(const e of from.keys()) d = d.put(e, e, false); }
      return d;
    }
    if(to instanceof LSet){ let s = to; const add = c => { if(Array.isArray(c)) c.forEach(e => s.add(e, true)); else if(c instanceof LSet) for(const e of c.keys()) s.add(e, true); else if(c instanceof Dict) for(const k of c.keys()) s.add(k, true); }; add(from); return s; }
    return to;
  }, '把 from 的元素并入 to：(into to from) 对 list/dict/set 分别做拼接/合并/并入，返回新集合。例 (into (list 1) (list 2 3)) => (1 2 3)');
  const _assocIn = (m, ks, v)=> {
    if(ks.length === 0) return v;
    const k = ks[0];
    const child = (m instanceof Dict) ? (m.has(k) ? m.get(k) : null) : (Array.isArray(m) ? m[k] : null);
    const newChild = _assocIn(child, ks.slice(1), v);
    if(m instanceof Dict) return m.put(k, newChild);
    if(Array.isArray(m)){ const a = m.slice(); a[k] = newChild; return a; }
    return new Dict().put(k, newChild);   // 路径缺失：为下一层建空 Dict 继续嵌套
  };
  const _dissocIn = (m, ks)=> {
    if(ks.length === 0) return m;
    const k = ks[0];
    if(ks.length === 1){
      if(m instanceof Dict){ const nd = new Dict(); for(const kk of m.keys()) if(kk !== k) nd.put(kk, m.get(kk), false); return nd; }
      if(Array.isArray(m)){ const a = m.slice(); a.splice(k, 1); return a; }
      return m;
    }
    const child = (m instanceof Dict) ? (m.has(k) ? m.get(k) : null) : (Array.isArray(m) ? m[k] : null);
    const newChild = _dissocIn(child, ks.slice(1));
    return (m instanceof Dict) ? m.put(k, newChild) : (Array.isArray(m) ? (()=>{ const a = m.slice(); a[k] = newChild; return a; })() : newChild);
  };
  def('assoc-in', (m, ks, v)=> _assocIn(m, ks, v), '嵌套写入：(assoc-in m (k1 …) v) 沿路径创建/更新嵌套结构，返回新集合(原值不变)。例 (assoc-in (dict) (list (quote a) (quote b)) 9) => #{a #{b 9}}');
  def('dissoc-in', (m, ks)=> _dissocIn(m, ks), '嵌套删除：(dissoc-in m (k1 …)) 沿路径删除最内层键，返回新集合。例 (dissoc-in (dict (quote a) (dict (quote b) 1)) (list (quote a) (quote b))) => #{a #{}}');
  def('rem', (a, b)=> { const B = b|0; if(B === 0) return 0; return a - Math.trunc(a/B)*B; }, '取模余数(符号跟随被除数，同 JS %)：(rem a b) => a - trunc(a/b)*b。例 (rem 7 3) => 1、(rem -7 3) => -1');
  def('quot', (a, b)=> { const B = b|0; if(B === 0) return 0; return Math.trunc(a / B); }, '整数除法(向零取整)：(quot a b) => trunc(a/b)。例 (quot 7 3) => 2、(quot -7 3) => -2');
  def('atan', (a, b)=> { if(b == null) return Math.atan(a); return Math.atan2(a, b); }, '反正切：单参 atan(x)；双参 atan(y x) 返回四象限角度。例 (atan 1) => 0.785…、(atan 1 0) => 1.570…');
  // ---- 嵌套存取 / 反转 / 判空补充 ----
  def('ffirst', (l)=> { if(!Array.isArray(l) || l.length === 0) return null; const f = l[0]; return (Array.isArray(f) && f.length) ? f[0] : null; }, '取嵌套列表的「首首」元素：(ffirst l) 返回 (first l) 的首元素。例 (ffirst (list (list 1 2) 3)) => 1、(ffirst (list (list) 3)) => null');
  def('fnext', (l)=> { if(!Array.isArray(l) || l.length === 0) return []; const f = l[0]; return (Array.isArray(f) && f.length > 1) ? f.slice(1) : []; }, '取嵌套列表「首元素之余」：(fnext l) 返回 (first l) 去掉首元素后的余部。例 (fnext (list (list 1 2) 3)) => (2)');
  def('reversed', (l)=> { if(!Array.isArray(l)) return []; return l.slice().reverse(); }, '返回反转后的新列表(不修改原列表)：(reversed l) 例 (reversed (list 1 2 3)) => (3 2 1)');

  // ---- 字符串工具补全：前缀/后缀判定、补齐、索引 ----
  def('string-starts-with?', (s, sub)=> String(s).startsWith(String(sub)), '判断字符串是否以指定前缀开头。例 (string-starts-with? "hello" "he") => #t');
  def('string-ends-with?', (s, sub)=> String(s).endsWith(String(sub)), '判断字符串是否以指定后缀结尾。例 (string-ends-with? "hello" "lo") => #t');
  def('string-pad-start', (s, n, ch)=> String(s).padStart(Math.max(0, n|0), ch == null ? ' ' : String(ch)), '在左侧用填充字符 ch(默认空格)补齐到长度 n。例 (string-pad-start "7" 3 "0") => "007"');
  def('string-pad-end', (s, n, ch)=> String(s).padEnd(Math.max(0, n|0), ch == null ? ' ' : String(ch)), '在右侧用填充字符 ch(默认空格)补齐到长度 n。例 (string-pad-end "7" 3 "0") => "700"');
  def('char-at', (s, i)=> { const str = String(s); const c = str[i|0]; return (c === undefined) ? null : c; }, '按索引取字符串第 i 个字符(0 基)，越界返回 null。例 (char-at "abc" 1) => "b"');

  // ---- 字符串/集合补充：连接/大小写/裁剪/空白判定/集合判定 ----
  def('join', (coll, sep)=> {
    const s = (sep == null) ? '' : String(sep);
    if(!Array.isArray(coll)) return '';
    return coll.map(x => (x == null ? '' : String(x))).join(s);
  }, '将列表元素用分隔符 sep 连接成字符串；nil 元素视作空串。例 (join (list 1 2 3) ",") => "1,2,3"、(join (list "a" "b") "-") => "a-b"');
  def('upper', (s)=> String(s).toUpperCase(), '将字符串转为大写。例 (upper "hi") => "HI"');
  def('lower', (s)=> String(s).toLowerCase(), '将字符串转为小写。例 (lower "HI") => "hi"');
  def('trim', (s)=> String(s).trim(), '去除字符串首尾空白。例 (trim "  x  ") => "x"');
  def('blank?', (x)=> x === null || x === undefined || (typeof x === 'string' && x.trim() === '') || (Array.isArray(x) && x.length === 0), '判空/空白：nil/未定义/空或全空白字符串/空列表 均为真。例 (blank? "") => #t、(blank? "  ") => #t、(blank? (list)) => #t、(blank? 5) => #f');
  def('coll?', (x)=> Array.isArray(x) || (x instanceof LSet) || (x instanceof Dict), '判断是否为集合类型(list/set/dict)。例 (coll? (list 1)) => #t、(coll? (set 1)) => #t、(coll? 5) => #f');

  // ---- 列表组合/矩阵工具 ----
  def('transpose', (m)=> {
    if(!Array.isArray(m) || m.length === 0) return [];
    const rows = m.map(r => Array.isArray(r) ? r : [r]);
    const ncols = Math.max(...rows.map(r => r.length));
    const out = [];
    for(let c = 0; c < ncols; c++){ const col = []; for(const r of rows) col.push(r[c] ?? null); out.push(col); }
    return out;
  }, '矩阵转置：输入为列表的列表(每子列表一行)，返回列转行的列表；空行补 null。例 (transpose (list (list 1 2) (list 3 4))) => ((1 3) (2 4))');
  def('zip-with', (f, a, b)=> {
    if(!Array.isArray(a) || !Array.isArray(b)) return [];
    const n = Math.min(a.length, b.length), out = [];
    for(let i=0;i<n;i++) out.push(applyFn(f, [a[i], b[i]]));
    return out;
  }, '并行归约：对两列表同位置元素依次调用 f，返回结果列表(长度取较短者)。例 (zip-with + (list 1 2) (list 10 20)) => (11 22)');
  def('cartesian-product', (...ls)=> {
    let acc = [[]];
    for(const l of ls){ if(!Array.isArray(l)) return []; const next = []; for(const p of acc) for(const x of l) next.push(p.concat([x])); acc = next; }
    return acc;
  }, '笛卡尔积：输入多个列表，返回其所有组合的列表(每组合为子列表，顺序与入参一致)。例 (cartesian-product (list 1 2) (list 3 4)) => ((1 3) (1 4) (2 3) (2 4))');

  // ---- 数值与数学(反三角函数) ----
  def('atan2', (y, x)=> Math.atan2(y, x), '反正切二参数(按象限返回 [-π,π])。例 (atan2 1 0) => 1.5707…、(atan2 0 1) => 0');
  def('asin', (a)=> Math.asin(a), '反正弦(输入须在 [-1,1]，否则 NaN)。例 (asin 1) => 1.5707…');
  def('acos', (a)=> Math.acos(a), '反余弦(输入须在 [-1,1]，否则 NaN)。例 (acos 0) => 1.5707…');

  // ---- 列表尾部/索引工具 ----
  def('take-last', (l, n)=> Array.isArray(l) ? l.slice(Math.max(0, l.length - Math.max(0, n|0))) : [], '取列表末尾 n 个元素(新列表)。例 (take-last (list 1 2 3 4) 2) => (3 4)');
  def('drop-last', (l, n)=> Array.isArray(l) ? l.slice(0, Math.max(0, l.length - Math.max(0, n|0))) : [], '丢弃列表末尾 n 个元素。例 (drop-last (list 1 2 3 4) 2) => (1 2)');
  def('enumerate', (l)=> { if(!Array.isArray(l)) return []; const out = []; for(let i=0;i<l.length;i++) out.push([i, l[i]]); return out; }, '给列表每个元素附上从 0 起的索引，返回 (索引 值) 对的列表。例 (enumerate (list "a" "b")) => ((0 "a") (1 "b"))');
  def('repeat', (x, n)=> { const cnt = Math.max(0, n|0), out = []; for(let i=0;i<cnt;i++) out.push(x); return out; }, '把元素 x 重复 n 次组成列表。例 (repeat 7 3) => (7 7 7)');

  // ---- 数值与数学(补全) ----
  def('divmod', (a, b)=> {
    if(b === 0) throw lispError('divmod: 除以零');
    const q = Math.trunc(a / b);
    return [q, a - q * b];
  }, '整除取商与余数：(divmod a b) 返回 (商 余数) 列表(余数符号同 a)。例 (divmod 17 5) => (3 2)、(divmod -17 5) => (-3 -2)');
  def('trunc', (a)=> Math.trunc(a), '向零截断取整(丢弃小数部分)。例 (trunc -3.7) => -3、(trunc 2.9) => 2');

  // ---- 字符串工具补全 ----
  def('string-blank?', (s)=> { const t = String(s); return t.length === 0 || t.trim().length === 0; }, '判断字符串是否为空或全部空白。例 (string-blank? "  ") => #t、(string-blank? "a") => #f');
  def('chars', (s)=> String(s).split(''), '将字符串拆为字符列表(每个元素一个字符)。例 (chars "abc") => ("a" "b" "c")');
  def('list->string', (l)=> Array.isArray(l) ? l.map(x => typeof x === 'string' ? x : lispStr(x)).join('') : '', '将字符列表拼接为字符串(非字符串元素按 lispStr 渲染)。例 (list->string (chars "hi")) => "hi"');

  // ---- 列表滑动窗口 ----
  def('windows', (n, l)=> {
    if(!Array.isArray(l)) return [];
    const size = Math.max(1, n|0), out = [];
    if(l.length < size) return [];
    for(let i=0; i + size <= l.length; i++) out.push(l.slice(i, i + size));
    return out;
  }, '滑动窗口：以窗口大小 n 在列表上滑动，返回每个窗口(末窗口起点 = len-n)。例 (windows 2 (list 1 2 3 4)) => ((1 2) (2 3) (3 4))');

  // ---- 列表整形（续）：本批新增 ----
  def('flatten1', (l)=>{
    if(!Array.isArray(l)) return [];
    const out = [];
    for(const e of l){ if(Array.isArray(e)) for(const x of e) out.push(x); else out.push(e); }
    return out;
  }, '仅展平一层。例 (flatten1 (quote ((1 2) (3)))) => (1 2 3)');
  def('rotate-left', (n, l)=>{
    if(!Array.isArray(l) || l.length === 0) return [];
    const k = (((n|0) % l.length) + l.length) % l.length;
    return l.slice(k).concat(l.slice(0, k));
  }, '向左旋转 n 位(前 n 个移到末尾)。例 (rotate-left 1 (list 1 2 3 4)) => (2 3 4 1)');
  def('rotate-right', (n, l)=>{
    if(!Array.isArray(l) || l.length === 0) return [];
    const k = (((n|0) % l.length) + l.length) % l.length;
    return l.slice(l.length - k).concat(l.slice(0, l.length - k));
  }, '向右旋转 n 位(末 n 个移到开头)。例 (rotate-right 1 (list 1 2 3 4)) => (4 1 2 3)');
  def('remove', (f, l)=>{
    if(!Array.isArray(l)) return [];
    return l.filter(x=>{ const v = applyFn(f, [x]); return v === false || v === null; });
  }, '剔除谓词为真者(与 filter 互补)。例 (remove even? (list 1 2 3 4)) => (1 3)');
  def('keep', (f, l)=>{
    if(!Array.isArray(l)) return [];
    const out = [];
    for(const x of l){ const v = applyFn(f, [x]); if(v !== false && v !== null) out.push(v); }
    return out;
  }, '对元素映射 f，丢弃 #f/null 结果。例 (keep (lambda (x) (if (> x 2) x #f)) (list 1 2 3 4)) => (3 4)');
  def('map-indexed', (f, l)=>{
    if(!Array.isArray(l)) return [];
    return l.map((x, i)=> applyFn(f, [i, x]));
  }, '同 map，但回调接收 (索引 元素)。例 (map-indexed (lambda (i x) (+ i x)) (list 10 10 10)) => (10 11 12)');
  def('foldl1', (f, l)=>{
    if(!Array.isArray(l) || l.length === 0) return null;
    let acc = l[0];
    for(let i=1;i<l.length;i++) acc = applyFn(f, [acc, l[i]]);
    return acc;
  }, '从左折叠，首元素作初始累加值(空列表返回 ())。例 (foldl1 + (list 1 2 3 4)) => 10');
  def('foldr1', (f, l)=>{
    if(!Array.isArray(l) || l.length === 0) return null;
    let acc = l[l.length - 1];
    for(let i=l.length-2;i>=0;i--) acc = applyFn(f, [l[i], acc]);
    return acc;
  }, '从右折叠，末元素作初始累加值。例 (foldr1 (lambda (a b) (list a b)) (list 1 2 3)) => (1 (2 3))');
  def('count-where', (f, l)=>{
    if(!Array.isArray(l)) return 0;
    let c = 0; for(const x of l){ const v = applyFn(f, [x]); if(v !== false && v !== null) c++; }
    return c;
  }, '统计谓词为真者的个数。例 (count-where even? (list 1 2 3 4)) => 2');
  def('slice', (start, end, l)=>{
    if(!Array.isArray(l)) return [];
    const s = Math.max(0, start|0), e = (end == null) ? l.length : Math.max(s, end|0);
    return l.slice(s, e);
  }, '取子列表 [start, end)。例 (slice 1 3 (list 1 2 3 4)) => (2 3)');
  def('take-nth', (n, l)=>{
    const step = Math.max(1, n|0);
    if(!Array.isArray(l)) return [];
    const out = []; for(let i=0;i<l.length;i+=step) out.push(l[i]);
    return out;
  }, '每 n 个取一个(从首个起)。例 (take-nth 2 (list 1 2 3 4 5)) => (1 3 5)');

  // ---- 数值/字符串/列表 补充工具 ----
  def('factorial', (n)=>{ const v = Math.trunc(Number(n)); if(v < 0) throw lispError('factorial: 负数无阶乘'); let r = 1; for(let i = 2; i <= v; i++) r *= i; return r; }, '阶乘：(factorial n) 返回 n!（n 为非负整数，0!=1）。例 (factorial 5) => 120');
  def('is-prime', (n)=>{ const v = Math.trunc(Number(n)); if(v < 2) return false; if(v % 2 === 0) return v === 2; for(let i = 3; i * i <= v; i += 2) if(v % i === 0) return false; return true; }, '素数判定：(is-prime n) 返回 n 是否为素数（>=2 且仅被 1 与自身整除）。例 (is-prime 7) => #t、(is-prime 9) => #f');
  def('negate', (x)=> -Number(x), '取相反数：(negate x) 返回 -x。例 (negate 5) => -5、(negate -3) => 3');
  def('to-degrees', (r)=> Number(r) * 180 / Math.PI, '弧度转角度：(to-degrees r) 将弧度换算为角度。例 (to-degrees 1.5708) ≈ 90');
  def('to-radians', (d)=> Number(d) * Math.PI / 180, '角度转弧度：(to-radians d) 将角度换算为弧度。例 (to-radians 180) ≈ 3.14159');
  def('string-index-of', (s, sub)=> String(s).indexOf(String(sub)), '子串首次出现位置(找不到返回 -1)：(string-index-of s sub) 返回 sub 在 s 中的 0 基索引。例 (string-index-of "hello" "ll") => 2');
  def('string-repeat', (s, n)=> String(s).repeat(Math.max(0, Math.trunc(Number(n)))), '重复字符串：(string-repeat s n) 将 s 重复 n 次拼接。例 (string-repeat "ab" 3) => "ababab"');
  def('string-upper', (s)=> String(s).toUpperCase(), '转为大写：(string-upper s) 返回 s 的全大写形式。例 (string-upper "Hi") => "HI"');
  def('string-lower', (s)=> String(s).toLowerCase(), '转为小写：(string-lower s) 返回 s 的全小写形式。例 (string-lower "Hi") => "hi"');
  def('replicate', (n, x)=>{ const m = Math.max(0, Math.trunc(Number(n))); const out = []; for(let i = 0; i < m; i++) out.push(x); return out; }, '重复构造列表：(replicate n x) 返回含 n 个 x 的列表。例 (replicate 3 0) => (0 0 0)');
  def('cycle', (n, l)=>{ if(!Array.isArray(l) || l.length === 0) return []; const out = [], m = Math.max(0, Math.trunc(Number(n))); for(let i = 0; i < m; i++) out.push(l[i % l.length]); return out; }, '循环取样：(cycle n l) 从 l 循环取前 n 个元素(不足则从头复用)；l 为空或 n<=0 返回空列表(不再推入 undefined)。例 (cycle 5 (list 1 2)) => (1 2 1 2 1)、(cycle 3 (list)) => ()');
  def('pad', (n, x, l)=>{ if(!Array.isArray(l)) return []; const out = l.slice(); while(out.length < Math.max(0, Math.trunc(Number(n)))) out.push(x); return out; }, '右侧补齐长度：(pad n x l) 在 l 末尾用 x 补齐至长度 n(已够长则原样)。例 (pad 5 0 (list 1 2)) => (1 2 0 0 0)');

  // ---- 列表/谓词 补充工具 ----
  def('fourth', (l)=> Array.isArray(l) ? (l[3] ?? null) : null, '取列表第 4 个元素；不足返回空(())。例 (fourth (list 1 2 3 4)) => 4');
  def('identity', (x)=> x, '恒等函数：(identity x) 原样返回 x。常用于排序/映射的占位。例 (map identity (list 1 2)) => (1 2)');
  def('constantly', (x)=> (()=> x), '常数函数：(constantly x) 返回一个无论参数都返回 x 的函数。例 (map (constantly 0) (list 1 2 3)) => (0 0 0)');
  def('some?', (f, l)=> Array.isArray(l) ? l.some(x=>{ const v = applyFn(f, [x]); return v !== false && v !== null; }) : false, '存在判定：(some? f l) 当 l 中存在元素使 (f 元素) 为真(非 false/null)时返回 #t。例 (some? even? (list 1 3 4)) => #t');
  def('not-any?', (f, l)=> Array.isArray(l) ? !l.some(x=>{ const v = applyFn(f, [x]); return v !== false && v !== null; }) : true, '全否判定：(not-any? f l) 当 l 中没有任何元素使 (f 元素) 为真时返回 #t。例 (not-any? even? (list 1 3 5)) => #t');
  def('dedupe', (l)=>{ if(!Array.isArray(l)) return []; const out = []; let last = null, has = false; for(const e of l){ const k = JSON.stringify(e); if(!has || k !== last){ out.push(e); last = k; has = true; } } return out; }, '去除相邻重复(保留各段首次)：(dedupe xs) 仅合并连续相等的元素(与 distinct 全量去重不同)。例 (dedupe (list 1 1 2 2 1)) => (1 2 1)');
  def('intersperse', (sep, l)=>{ if(!Array.isArray(l)) return []; const out = []; for(let i=0;i<l.length;i++){ out.push(l[i]); if(i < l.length-1) out.push(sep); } return out; }, '间隔插入：(intersperse sep l) 在 l 每两个元素之间插入 sep。例 (intersperse 0 (list 1 2 3)) => (1 0 2 0 3)');
  def('max-by', (f, l)=>{ if(!Array.isArray(l) || l.length === 0) return null; let best = l[0], bv = applyFn(f, [l[0]]); for(let i=1;i<l.length;i++){ const v = applyFn(f, [l[i]]); if(v > bv){ best = l[i]; bv = v; } } return best; }, '按键值取最大：(max-by f l) 返回使 (f x) 最大的元素。例 (max-by (lambda (x) (first x)) (list (list 1 \"a\") (list 3 \"b\") (list 2 \"c\"))) => (3 \"b\")');
  def('min-by', (f, l)=>{ if(!Array.isArray(l) || l.length === 0) return null; let best = l[0], bv = applyFn(f, [l[0]]); for(let i=1;i<l.length;i++){ const v = applyFn(f, [l[i]]); if(v < bv){ best = l[i]; bv = v; } } return best; }, '按键值取最小：(min-by f l) 返回使 (f x) 最小的元素。例 (min-by (lambda (x) (first x)) (list (list 1 \"a\") (list 3 \"b\") (list 2 \"c\"))) => (1 \"a\")');

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
    const R = (typeof require === 'function') ? require : (typeof globalThis !== 'undefined' ? globalThis.require : undefined);
    if(typeof R !== 'function') throw lispError('read-file 仅在 Node 环境可用');
    return R('fs').readFileSync(String(p), 'utf8');
  });
  def('write-file', (p, content)=> {
    const R = (typeof require === 'function') ? require : (typeof globalThis !== 'undefined' ? globalThis.require : undefined);
    if(typeof R !== 'function') throw lispError('write-file 仅在 Node 环境可用');
    R('fs').writeFileSync(String(p), String(content), 'utf8');
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
  D('and', '逻辑与(短路宏)：(and a b …) 依次求值，遇 false/null 即返回它，否则返回最后一个值；全为真时返回末值');
  D('or', '逻辑或(短路宏)：(or a b …) 依次求值，遇非 false/null 即返回它，否则返回最后一个值；全为假时返回末值(通常为 false)');
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
  D('compose', '函数组合(右到左)：(compose f g h) 返回新函数，调用时等价于 f(g(h(参数…)))，与 comp 语义一致；参数透传给最右函数；零参时返回恒等函数');
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
  D('read-file', '读取文本文件：(read-file path) 以 UTF-8 读取文件全部内容并返回字符串(仅在 Node 环境可用，浏览器降级为抛错)');
  D('write-file', '写入文本文件：(write-file path content) 以 UTF-8 把 content 写入文件(覆盖)，成功返回 null(仅在 Node 环境可用)');

  // ===== 自驱循环新增内置（ci247~ci275）=====
  // ---- ci247: 序列切片 ----
  def('nfirst', (n, coll)=> Array.isArray(coll) ? coll.slice(0, n) : [], '取序列前 n 个元素组成新列表：(nfirst n coll) 等价于 (take coll n)。例 (nfirst 2 (list 1 2 3 4)) => (1 2)');
  def('nthrest', (n, coll)=> Array.isArray(coll) ? coll.slice(n) : [], '取序列第 n 个(0 基)之后的剩余部分：(nthrest n coll) 等价于 (drop coll n)。例 (nthrest 1 (list (quote a) (quote b) (quote c))) => (b c)');

  // ---- ci251: 分组与嵌套更新 ----
  def('partition-n', (n, coll)=> {
    if(!Array.isArray(coll) || !Number.isInteger(n) || n <= 0) return [];
    const out = [];
    for(let i = 0; i + n <= coll.length; i += n) out.push(coll.slice(i, i + n));
    return out;
  }, '按固定大小 n 将序列分成若干长度为 n 的子列表(最后不足 n 个的尾部丢弃)，返回「列表的列表」。例 (partition-n 2 (list 1 2 3 4)) => ((1 2) (3 4))');
  def('update-in', (m, ks, f, ...args)=> {
    if(!Array.isArray(ks)) throw lispError('update-in 需要键序列(list)');
    const rec = (node, path) => {
      if(path.length === 0) return node;
      const k = path[0];
      const child = (node instanceof Dict) ? (node.has(k) ? node.get(k) : null)
                   : (Array.isArray(node) ? node[k] : null);
      if(path.length === 1){
        const nv = applyFn(f, [child === undefined ? null : child, ...args]);
        if(node instanceof Dict) return node.put(k, nv);
        if(Array.isArray(node)){ const a = node.slice(); a[k] = nv; return a; }
        return new Dict().put(k, nv);
      }
      const newChild = rec(child, path.slice(1));
      if(node instanceof Dict) return node.put(k, newChild);
      if(Array.isArray(node)){ const a = node.slice(); a[k] = newChild; return a; }
      return new Dict().put(k, newChild);
    };
    return rec(m, ks);
  }, '不可变更新嵌套结构：(update-in m (k1 …) f & args) 沿路径 ks 取到当前值，以 (f 当前值 ...args) 计算新值并写回，返回新集合(原值不变)。例 (update-in (dict (quote a) (dict (quote b) 1)) (list (quote a) (quote b)) (lambda (v) (+ v 10))) => #{a #{b 11}}');

  // ---- ci255: 向量与判空 ----
  def('vector', (...args)=> args, '构造向量(列表)：(vector a b c) 返回由参数组成的列表 (a b c)。例 (vector 1 2 3) => (1 2 3)');
  def('not-empty?', (coll)=> {
    if(coll === null || coll === undefined) return false;
    if(Array.isArray(coll)) return coll.length > 0;
    if(typeof coll === 'string') return coll.length > 0;
    if(coll instanceof Dict) return coll.len > 0;
    if(coll instanceof LSet) return coll.len > 0;
    return true;
  }, '判断集合是否非空(empty? 的反义)：非空列表/非空字符串/非空 dict/非空 set 为真，空集合或 nil 为假。例 (not-empty? (list 1)) => #t、(not-empty? (list)) => #f');

  // ---- ci259: 序列判定与 next ----
  def('seq?', (x)=> Array.isArray(x) || typeof x === 'string', '判断是否为序列(列表/向量/字符串)。例 (seq? (list 1 2)) => #t、(seq? "abc") => #t、(seq? 5) => #f');
  def('next', (x)=> {
    if(Array.isArray(x)) return x.slice(1);
    if(typeof x === 'string') return x.slice(1);
    return null;
  }, '返回序列除首元素后的剩余部分(空序列返回空列表/空串)：列表/向量用 (rest …)，字符串返回去首字符的子串。例 (next (list 1 2 3)) => (2 3)、(next (list 1)) => ()');

  // ---- ci263: 类型判定 ----
  def('map?', (x)=> x instanceof Dict, '判断是否为映射(map/dict)。例 (map? (dict (quote a) 1)) => #t、(map? (list 1)) => #f');
  def('vector?', (x)=> Array.isArray(x), '判断是否为向量(列表)。例 (vector? (vector 1 2)) => #t、(vector? (dict)) => #f');

  // ---- ci267: 函数与整数判定 ----
  def('fn?', (x)=> typeof x === 'function' || (x && x.__lambda) === true, '判断是否为函数(含 lambda 闭包)。例 (fn? (lambda (x) x)) => #t、(fn? 5) => #f');
  def('int?', (x)=> typeof x === 'number' && Number.isInteger(x), '判断是否为整数(含负整数)。例 (int? 5) => #t、(int? -3) => #t、(int? 2.5) => #f');

  // ---- ci271: 缺失谓词 ----
  def('char?', (x)=> typeof x === 'string' && x.length === 1, '判断是否为单字符(长度为 1 的字符串)。例 (char? "a") => #t、(char? "ab") => #f');
  def('sorted?', (coll)=> {
    if(!Array.isArray(coll)) return false;
    for(let i = 1; i < coll.length; i++){ if(!(coll[i-1] <= coll[i])) return false; }
    return true;
  }, '判断序列是否升序排列(每相邻元素满足 <=)。例 (sorted? (list 1 2 3)) => #t、(sorted? (list 3 1)) => #f、(sorted? (list)) => #t');

  // ---- ci275: 缺失数值 helper ----
  def('square', (x)=> { const n = Number(x); return n * n; }, '平方：(square x) 返回 x 的平方。例 (square 5) => 25、(square -3) => 9');
  def('double', (x)=> Number(x) * 2, '加倍：(double x) 返回 x*2。例 (double 21) => 42、(double 0) => 0');

  // ---- ci327: 数字/字符串 helper ----
  def('sign', (x)=> Math.sign(Number(x)), '符号函数：(sign x) 正数返回 1、负数返回 -1、零返回 0。例 (sign -5) => -1、(sign 3) => 1、(sign 0) => 0');
  def('digits', (n)=> { const v = Number(n); if(!isFinite(v)) return []; const num = Math.abs(Math.trunc(v)); return String(num).split('').map(c=> c.charCodeAt(0) - 48); }, '拆数字为各位列表(忽略符号)：(digits n) 返回 n 各十进制位组成的列表；非数字/非有限输入返回空列表(修复此前对 "abc" 返回 [30 49 30] 的隐患)。例 (digits 123) => (1 2 3)、(digits -45) => (4 5)、(digits 0) => (0)、(digits "abc") => ()');
  def('from-digits', (l)=> { if(!Array.isArray(l) || l.length === 0) return 0; return l.reduce((a, d)=> a * 10 + (Math.trunc(Number(d)) || 0), 0); }, '各位列表拼回数字：(from-digits l) 将十进制位列表还原为整数；空列表返回 0。例 (from-digits (list 1 2 3)) => 123');
  def('digit-sum', (n)=> { const v = Math.abs(Math.trunc(Number(n))); let s = 0; for(const c of String(v)) s += c.charCodeAt(0) - 48; return s; }, '各位数字之和(忽略符号)：(digit-sum n)。例 (digit-sum 123) => 6、(digit-sum -99) => 18');
  def('palindrome?', (x)=> { const s = Array.isArray(x) ? x.map(e=> JSON.stringify(e)) : String(x).split(''); for(let i = 0, j = s.length - 1; i < j; i++, j--){ if(s[i] !== s[j]) return false; } return true; }, '回文判定：(palindrome? x) 支持字符串或列表，正读反读一致返回 #t。例 (palindrome? "level") => #t、(palindrome? (list 1 2 1)) => #t、(palindrome? "abc") => #f');
  def('string-pad-left', (s, n, p)=> String(s).padStart(Math.max(0, Math.trunc(Number(n))), p === undefined ? ' ' : String(p)), '左侧补齐：(string-pad-left s n p) 用 p(默认空格)在左侧补至长度 n。例 (string-pad-left "7" 3 "0") => "007"');
  def('string-pad-right', (s, n, p)=> String(s).padEnd(Math.max(0, Math.trunc(Number(n))), p === undefined ? ' ' : String(p)), '右侧补齐：(string-pad-right s n p) 用 p(默认空格)在右侧补至长度 n。例 (string-pad-right "ab" 4 "-") => "ab--"');
  // ---- ci331: 列表进阶 helper ----
  def('rotations', (l)=> { if(!Array.isArray(l)) return []; const n = l.length; if(n === 0) return [[]]; const out = []; for(let i = 0; i < n; i++) out.push(l.slice(i).concat(l.slice(0, i))); return out; }, '所有旋转：(rotations l) 返回 l 的全部循环左旋列表。例 (rotations (list 1 2 3)) => ((1 2 3) (2 3 1) (3 1 2))');
  def('chunk-by', (f, l)=> { if(!Array.isArray(l) || l.length === 0) return []; const out = []; let cur = [l[0]]; let prevKey = JSON.stringify(applyFn(f, [l[0]])); for(let i = 1; i < l.length; i++){ const k = JSON.stringify(applyFn(f, [l[i]])); if(k === prevKey){ cur.push(l[i]); } else { out.push(cur); cur = [l[i]]; prevKey = k; } } out.push(cur); return out; }, '按键值分块：(chunk-by f l) 相邻元素 f 值相同的归为一块。例 (chunk-by (lambda (x) (< x 3)) (list 1 2 5 6 2)) => ((1 2) (5 6) (2))');
  def('flatten-deep', (l)=> { if(!Array.isArray(l)) return []; const out = []; const walk = (x)=> { if(Array.isArray(x)){ for(const e of x) walk(e); } else out.push(x); }; walk(l); return out; }, '深度展平：(flatten-deep l) 递归展平任意嵌套列表；非列表输入返回空列表(与 flatten 一致，修复此前返回单元素包裹的不一致)。例 (flatten-deep (list 1 (list 2 (list 3 4)) 5)) => (1 2 3 4 5)、(flatten-deep 5) => ()');
  def('tally', (l)=> { const d = new Dict(); if(Array.isArray(l)){ for(const e of l){ d.put(e, (d.get(e) || 0) + 1, true); } } return d; }, '计数：(tally l) 返回元素出现次数的映射。例 (dict-get (tally (list "a" "b" "a")) "a") => 2');
  def('unzip', (l)=> { if(!Array.isArray(l) || l.length === 0) return [[], []]; const a = [], b = []; for(const p of l){ if(Array.isArray(p)){ a.push(p[0]); b.push(p[1]); } } return [a, b]; }, '解压对列表：(unzip l) 把二元组列表拆成两个列表。例 (unzip (list (list 1 "a") (list 2 "b"))) => ((1 2) ("a" "b"))');
  def('scanl', (f, init, l)=> { const out = [init]; let acc = init; if(Array.isArray(l)){ for(const e of l){ acc = applyFn(f, [acc, e]); out.push(acc); } } return out; }, '带初值前缀扫描：(scanl f init l) 返回含初值的累积结果列表。例 (scanl + 0 (list 1 2 3)) => (0 1 3 6)');
  // ---- ci335: 统计/取整 helper ----
  def('stddev', (l)=> { if(!Array.isArray(l) || l.length < 2) return 0; const a = l.map(x=>Number(x)||0); const m = a.reduce((s,x)=> s+x,0)/a.length; return Math.sqrt(a.reduce((s,x)=> s+(x-m)*(x-m),0)/(a.length-1)); }, '样本标准差（无偏，方差开方）：(stddev xs)；元素不足 2 个返回 0。例 (stddev (list 2 4 4 4 5 5 7 9)) ≈ 2.138');
  def('percentile', (l, p)=> { if(!Array.isArray(l) || l.length === 0) return 0; const a = l.map(x=>Number(x)||0).sort((x,y)=> x-y); const t = Math.min(100, Math.max(0, Number(p) || 0)) / 100; const idx = t * (a.length - 1); const lo = Math.floor(idx), hi = Math.ceil(idx); return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo); }, '百分位数（线性插值法）：(percentile xs p) p 取 0..100。例 (percentile (list 1 2 3 4) 50) => 2.5、(percentile (list 1 2 3 4) 0) => 1');
  def('argmax', (f, l)=> { if(!Array.isArray(l) || l.length === 0) return null; let best = l[0], bv = Number(applyFn(f, [l[0]])); for(let i = 1; i < l.length; i++){ const v = Number(applyFn(f, [l[i]])); if(v > bv){ bv = v; best = l[i]; } } return best; }, '取使 f 最大的元素（并列取最先）：(argmax f l)；空列表返回 null。例 (argmax (lambda (x) (* x x)) (list -3 2 1)) => -3');
  def('argmin', (f, l)=> { if(!Array.isArray(l) || l.length === 0) return null; let best = l[0], bv = Number(applyFn(f, [l[0]])); for(let i = 1; i < l.length; i++){ const v = Number(applyFn(f, [l[i]])); if(v < bv){ bv = v; best = l[i]; } } return best; }, '取使 f 最小的元素（并列取最先）：(argmin f l)；空列表返回 null。例 (argmin (lambda (x) (abs x)) (list -3 2 1)) => 1');
  def('round-to', (x, step)=> { const s = Math.abs(Number(step)) || 1; const r = Math.round(Number(x) / s) * s; const dec = (String(s).split('.')[1] || '').length; return dec ? Number(r.toFixed(dec)) : r; }, '取整到最近的 step 倍数：(round-to x step)；step 为 0 时按 1 处理。例 (round-to 7 5) => 5、(round-to 8 5) => 10、(round-to 3.14159 0.01) => 3.14');
  // ci339 统计/向量批次：covariance / correlation / zscore / softmax / cosine-sim
  def('covariance', (xs, ys)=> { if(!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) return 0; const a = xs.map(v=>Number(v)||0), b = ys.map(v=>Number(v)||0); const n = a.length; const ma = a.reduce((s,v)=> s+v,0)/n, mb = b.reduce((s,v)=> s+v,0)/n; let s = 0; for(let i=0;i<n;i++) s += (a[i]-ma)*(b[i]-mb); return s/(n-1); }, '样本协方差（无偏, n-1）：(covariance xs ys)；长度不同或不足 2 返回 0。例 (covariance (list 1 2 3) (list 2 4 6)) => 2');
  def('correlation', (xs, ys)=> { if(!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) return 0; const a = xs.map(v=>Number(v)||0), b = ys.map(v=>Number(v)||0); const n = a.length; const ma = a.reduce((s,v)=> s+v,0)/n, mb = b.reduce((s,v)=> s+v,0)/n; let sab=0, sa=0, sb=0; for(let i=0;i<n;i++){ const da=a[i]-ma, db=b[i]-mb; sab+=da*db; sa+=da*da; sb+=db*db; } const d = Math.sqrt(sa*sb); return d === 0 ? 0 : sab/d; }, '皮尔逊相关系数 [-1,1]：(correlation xs ys)；退化(零方差/长度不符)返回 0。例 (correlation (list 1 2 3) (list 2 4 6)) => 1');
  def('zscore', (l)=> { if(!Array.isArray(l) || l.length < 2) return Array.isArray(l) ? l.map(()=>0) : []; const a = l.map(v=>Number(v)||0); const n = a.length; const m = a.reduce((s,v)=> s+v,0)/n; const sd = Math.sqrt(a.reduce((s,v)=> s+(v-m)*(v-m),0)/(n-1)); return sd === 0 ? a.map(()=>0) : a.map(v=> (v-m)/sd); }, '标准分数列表（样本标准差）：(zscore xs)；零方差或不足 2 个元素时返回全 0 列表。例 (zscore (list 1 2 3)) => (-1 0 1)');
  def('softmax', (l)=> { if(!Array.isArray(l) || l.length === 0) return []; const a = l.map(v=>Number(v)||0); const mx = Math.max(...a); const ex = a.map(v=> Math.exp(v-mx)); const s = ex.reduce((t,v)=> t+v,0); return ex.map(v=> v/s); }, 'softmax 归一化（减最大值防溢出，和为 1）：(softmax xs)。例 (softmax (list 0 0)) => (0.5 0.5)');
  def('cosine-sim', (xs, ys)=> { if(!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length === 0) return 0; const a = xs.map(v=>Number(v)||0), b = ys.map(v=>Number(v)||0); let dot=0, na=0, nb=0; for(let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; } const d = Math.sqrt(na)*Math.sqrt(nb); return d === 0 ? 0 : dot/d; }, '余弦相似度 [-1,1]：(cosine-sim xs ys)；零向量或长度不符返回 0。例 (cosine-sim (list 1 0) (list 0 1)) => 0、(cosine-sim (list 1 2) (list 2 4)) => 1');
  // ci343 向量批次：dot-product / magnitude / normalize / euclidean / manhattan
  def('dot-product', (xs, ys)=> { if(!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length) return 0; let s = 0; for(let i=0;i<xs.length;i++) s += (Number(xs[i])||0) * (Number(ys[i])||0); return s; }, '向量点积：(dot-product xs ys)；长度不符返回 0。例 (dot-product (list 1 2 3) (list 4 5 6)) => 32');
  def('magnitude', (xs)=> { if(!Array.isArray(xs)) return 0; let s = 0; for(const v of xs){ const n = Number(v)||0; s += n*n; } return Math.sqrt(s); }, '向量模长(欧几里得范数)：(magnitude xs)。例 (magnitude (list 3 4)) => 5');
  def('normalize', (xs)=> { if(!Array.isArray(xs) || xs.length === 0) return []; const a = xs.map(v=>Number(v)||0); const m = Math.sqrt(a.reduce((s,v)=> s+v*v,0)); return m === 0 ? a.map(()=>0) : a.map(v=> v/m); }, '向量单位化（模长归一）：(normalize xs)；零向量返回全 0。例 (normalize (list 3 4)) => (0.6 0.8)');
  def('euclidean', (xs, ys)=> { if(!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length) return 0; let s = 0; for(let i=0;i<xs.length;i++){ const d = (Number(xs[i])||0) - (Number(ys[i])||0); s += d*d; } return Math.sqrt(s); }, '欧几里得距离：(euclidean xs ys)；长度不符返回 0。例 (euclidean (list 0 0) (list 3 4)) => 5');
  def('manhattan', (xs, ys)=> { if(!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length) return 0; let s = 0; for(let i=0;i<xs.length;i++) s += Math.abs((Number(xs[i])||0) - (Number(ys[i])||0)); return s; }, '曼哈顿距离(L1)：(manhattan xs ys)；长度不符返回 0。例 (manhattan (list 0 0) (list 3 4)) => 7');
  // ci347 序列批次：cumsum / cumprod / diff-list / moving-avg / ema
  def('cumsum', (l)=> { if(!Array.isArray(l)) return []; let s = 0; return l.map(v=> s += (Number(v)||0)); }, '前缀和列表：(cumsum xs)。例 (cumsum (list 1 2 3 4)) => (1 3 6 10)');
  def('cumprod', (l)=> { if(!Array.isArray(l)) return []; let p = 1; return l.map(v=> p *= (Number(v)||0)); }, '前缀积列表：(cumprod xs)。例 (cumprod (list 1 2 3 4)) => (1 2 6 24)');
  def('diff-list', (l)=> { if(!Array.isArray(l) || l.length < 2) return []; const a = l.map(v=>Number(v)||0); const out = []; for(let i=1;i<a.length;i++) out.push(a[i]-a[i-1]); return out; }, '一阶差分（长度 n-1）：(diff-list xs)；不足 2 个返回空。例 (diff-list (list 1 4 9 16)) => (3 5 7)');
  def('moving-avg', (l, w)=> { if(!Array.isArray(l)) return []; const k = Math.max(1, Number(w)|0); if(l.length < k) return []; const a = l.map(v=>Number(v)||0); const out = []; let s = 0; for(let i=0;i<a.length;i++){ s += a[i]; if(i >= k) s -= a[i-k]; if(i >= k-1) out.push(s/k); } return out; }, '滑动平均（窗口 w，长度 n-w+1）：(moving-avg xs w)；n<w 返回空。例 (moving-avg (list 1 2 3 4) 2) => (1.5 2.5 3.5)');
  def('ema', (l, alpha)=> { if(!Array.isArray(l) || l.length === 0) return []; const a = l.map(v=>Number(v)||0); const al = Math.min(1, Math.max(0, Number(alpha) || 0)); const out = [a[0]]; for(let i=1;i<a.length;i++) out.push(al*a[i] + (1-al)*out[i-1]); return out; }, '指数移动平均（平滑系数 alpha∈[0,1]）：(ema xs alpha)；首项取原值。例 (ema (list 1 2 3) 1) => (1 2 3)、(ema (list 4 8) 0.5) => (4 6)');
  // ci351 字符串/频次批次：levenshtein / hamming / char-freq / mode / histogram
  def('levenshtein', (s1, s2)=> { const a = String(s1), b = String(s2); const m = a.length, n = b.length; if(m === 0) return n; if(n === 0) return m; let prev = Array.from({length: n+1}, (_, j)=> j); for(let i=1;i<=m;i++){ const cur = [i]; for(let j=1;j<=n;j++){ cur.push(Math.min(prev[j]+1, cur[j-1]+1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1))); } prev = cur; } return prev[n]; }, '编辑距离(Levenshtein)：(levenshtein s1 s2)。例 (levenshtein "kitten" "sitting") => 3');
  def('hamming', (s1, s2)=> { const a = String(s1), b = String(s2); if(a.length !== b.length) return -1; let d = 0; for(let i=0;i<a.length;i++) if(a[i] !== b[i]) d++; return d; }, '汉明距离（等长逐位不同数）：(hamming s1 s2)；长度不同返回 -1。例 (hamming "karolin" "kathrin") => 3');
  def('char-freq', (s)=> { const m = new Map(); for(const ch of String(s)) m.set(ch, (m.get(ch)||0)+1); const out = new Dict(); for(const [k,v] of m) out.put(k, v, true); return out; }, '字符频次 Dict：(char-freq s)。例 (dict-get (char-freq "aab") "a") => 2');
  def('mode', (l)=> { if(!Array.isArray(l) || l.length === 0) return null; const m = new Map(); for(const v of l){ const k = typeof v === 'number' ? v : String(v); m.set(k, (m.get(k)||0)+1); } let best = null, bc = -1; for(const v of l){ const k = typeof v === 'number' ? v : String(v); const c = m.get(k); if(c > bc){ bc = c; best = v; } } return best; }, '众数（并列取最先出现）：(mode xs)；空列表返回 null。例 (mode (list 1 2 2 3)) => 2');
  def('histogram', (l, bins)=> { if(!Array.isArray(l) || l.length === 0) return []; const k = Math.max(1, Number(bins)|0); const a = l.map(v=>Number(v)||0); const lo = Math.min(...a), hi = Math.max(...a); const out = new Array(k).fill(0); if(hi === lo){ out[0] = a.length; return out; } for(const v of a){ let idx = Math.floor((v - lo) / (hi - lo) * k); if(idx >= k) idx = k-1; out[idx]++; } return out; }, '直方图计数（k 个等宽桶, [min,max] 均分, 末桶闭区间）：(histogram xs k)。例 (histogram (list 1 2 3 4) 2) => (2 2)');
  // ci355 稳健统计批次：mad / winsorize / rank-list / geomean / harmonic-mean
  def('mad', (l)=> { if(!Array.isArray(l) || l.length === 0) return 0; const a = l.map(v=>Number(v)||0).sort((x,y)=> x-y); const med = (arr)=> { const n = arr.length; return n % 2 ? arr[(n-1)/2] : (arr[n/2-1] + arr[n/2]) / 2; }; const m = med(a); const dev = a.map(v=> Math.abs(v - m)).sort((x,y)=> x-y); return med(dev); }, '中位数绝对偏差(MAD, 稳健离散度)：(mad xs)。例 (mad (list 1 1 2 2 4 6 9)) => 1');
  def('winsorize', (l, p)=> { if(!Array.isArray(l) || l.length === 0) return []; const a = l.map(v=>Number(v)||0); const t = Math.min(0.5, Math.max(0, Number(p) || 0)); const srt = [...a].sort((x,y)=> x-y); const n = srt.length; const loI = Math.floor(n * t), hiI = Math.min(n-1, n - 1 - loI); const lo = srt[loI], hi = srt[hiI]; return a.map(v=> v < lo ? lo : v > hi ? hi : v); }, '缩尾处理（两端各截 p 比例钳到分位值, 保持原顺序）：(winsorize xs p)。例 (winsorize (list 1 5 6 7 100) 0.2) => (5 5 6 7 7)');
  def('rank-list', (l)=> { if(!Array.isArray(l)) return []; const a = l.map(v=>Number(v)||0); const srt = [...a].map((v,i)=> [v,i]).sort((x,y)=> x[0]-y[0]); const rank = new Array(a.length); let i = 0; while(i < srt.length){ let j = i; while(j+1 < srt.length && srt[j+1][0] === srt[i][0]) j++; const r = (i + j) / 2 + 1; for(let k2=i;k2<=j;k2++) rank[srt[k2][1]] = r; i = j+1; } return rank; }, '秩次列表（升序, 并列取平均秩, 1 起）：(rank-list xs)。例 (rank-list (list 30 10 20)) => (3 1 2)、(rank-list (list 5 5 9)) => (1.5 1.5 3)');
  def('geomean', (l)=> { if(!Array.isArray(l) || l.length === 0) return 0; const a = l.map(v=>Number(v)||0); if(a.some(v=> v <= 0)) return 0; return Math.exp(a.reduce((s,v)=> s + Math.log(v), 0) / a.length); }, '几何平均（对数求和防溢出）：(geomean xs)；含非正数返回 0。例 (geomean (list 2 8)) => 4');
  def('harmonic-mean', (l)=> { if(!Array.isArray(l) || l.length === 0) return 0; const a = l.map(v=>Number(v)||0); if(a.some(v=> v <= 0)) return 0; return a.length / a.reduce((s,v)=> s + 1/v, 0); }, '调和平均：(harmonic-mean xs)；含非正数返回 0。例 (harmonic-mean (list 1 4 4)) => 2');
  // ci359 日期时间批次：now / today / timestamp / format-date
  const dateParts = (d)=> {
    let date;
    if(typeof d === 'number') date = new Date(d);
    else if(typeof d === 'string') date = new Date(d);
    else if(Array.isArray(d)){
      const a = d.map(x => Number(x) || 0);
      if(a.length < 2 || !isFinite(a[0]) || !isFinite(a[1])) return null;
      date = new Date(a[0], a[1] - 1, a[2] || 1, a[3] || 0, a[4] || 0, a[5] || 0);
    } else return null;
    if(isNaN(date.getTime())) return null;
    return { y: date.getFullYear(), m: date.getMonth() + 1, day: date.getDate(), h: date.getHours(), min: date.getMinutes(), s: date.getSeconds() };
  };
  const _pad2 = (n)=> String(n).padStart(2, '0');
  const _pad4 = (n)=> String(n).padStart(4, '0');
  def('now', ()=> Date.now(), '当前时间戳(毫秒)：(now) 返回自 1970-01-01 UTC 起的毫秒数(等价于 JS Date.now())。例 (> (now) 0) => #t');
  def('today', ()=> { const p = dateParts(Date.now()); return _pad4(p.y) + '-' + _pad2(p.m) + '-' + _pad2(p.day); }, '今天日期(本地, YYYY-MM-DD)：(today) 返回当前本地日期字符串。例 (string-length (today)) => 10');
  def('timestamp', (d)=> {
    if(d === undefined || d === null) return null;
    if(typeof d === 'number') return d;
    if(typeof d === 'string'){ const ms = Date.parse(d); return isNaN(ms) ? null : ms; }
    const p = dateParts(d);
    return p === null ? null : new Date(p.y, p.m - 1, p.day, p.h, p.min, p.s).getTime();
  }, '转为时间戳(毫秒)：(timestamp d) 接受 数字(ms 透传) / 字符串(Date.parse) / 列表 [年 月 日 时 分 秒](月为 1 基) 三种形式，返回自纪元起的毫秒数；非法输入返回 null。例 (timestamp (list 2020 1 1)) => 约等于 (new Date(2020,0,1)).getTime()');
  def('format-date', (d, fmt)=> {
    const p = dateParts(d);
    if(p === null) return '';
    const f = (fmt === undefined || fmt === null) ? 'YYYY-MM-DD' : String(fmt);
    return f.replace('YYYY', _pad4(p.y)).replace('MM', _pad2(p.m)).replace('DD', _pad2(p.day)).replace('HH', _pad2(p.h)).replace('mm', _pad2(p.min)).replace('ss', _pad2(p.s));
  }, '格式化日期：(format-date d fmt) 按模板输出，支持 YYYY/MM/DD/HH/mm/ss 占位符；省略 fmt 默认 "YYYY-MM-DD"。d 同 timestamp 的三种形式，非法返回空串。例 (format-date (list 2020 1 5) "YYYY/MM/DD") => "2020/01/05"');

  // ci363 字符串批次：slugify / str-trim / str-pad / str-repeat / str-reverse
  def('slugify', (s)=> {
    const t = String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
    return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }, '转 slug：(slugify s) 转为小写、去重音、非字母数字替换为连字符并去首尾连字符。例 (slugify "Hello, World!") => "hello-world"、(slugify "  Foo  Bar  ") => "foo-bar"');
  def('str-trim', (s)=> String(s).trim(), '去除字符串首尾空白：(str-trim s)。例 (str-trim "  x  ") => "x"');
  def('str-pad', (s, n, ch, side)=> {
    const len = Math.max(0, Math.trunc(Number(n)) || 0);
    const pad = (ch === undefined || ch === null) ? ' ' : String(ch);
    const str = String(s);
    if(str.length >= len) return str;
    const need = len - str.length;
    const sd = (side === undefined || side === null) ? 'left' : String(side);
    if(sd === 'right') return str + pad.repeat(need);
    if(sd === 'both'){ const left = Math.ceil(need / 2); return pad.repeat(left) + str + pad.repeat(need - left); }
    return pad.repeat(need) + str;
  }, '左右补位：(str-pad s n ch side) 用 ch(默认空格) 在 side("left"默认/"right"/"both") 侧补至长度 n；已够长则原样返回。例 (str-pad "7" 3 "0") => "007"、(str-pad "7" 3 "0" "right") => "700"');
  def('str-repeat', (s, n)=> { const k = Math.trunc(Number(n)); if(!isFinite(k) || k < 0) return ''; return String(s).repeat(k); }, '重复字符串 n 次：(str-repeat s n) n 为负或非数字时返回空串。例 (str-repeat "ab" 3) => "ababab"');
  def('str-reverse', (s)=> String(s).split('').reverse().join(''), '反转字符串：(str-reverse s)。例 (str-reverse "hello") => "olleh"');

  // ci375 编码批次：base64-encode / base64-decode / url-encode / url-decode
  const _b64enc = (str)=> {
    const s = String(str);
    if(typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(s)));
  };
  const _b64dec = (str)=> {
    const s = String(str);
    if(typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf8');
    return decodeURIComponent(escape(atob(s)));
  };
  def('base64-encode', (s)=> _b64enc(s), 'Base64 编码：(base64-encode s) 将字符串按 UTF-8 编码为 Base64 串。例 (base64-encode "hello") => "aGVsbG8="');
  def('base64-decode', (s)=> _b64dec(s), 'Base64 解码：(base64-decode s) 将 Base64 串解码为原字符串。例 (base64-decode "aGVsbG8=") => "hello"');
  def('url-encode', (s)=> encodeURIComponent(String(s)), 'URL 编码：(url-encode s) 按 encodeURIComponent 编码(空格->%20 等)。例 (url-encode "a b&c") => "a%20b%26c"');
  def('url-decode', (s)=> { try { return decodeURIComponent(String(s)); } catch(e){ return String(s); } }, 'URL 解码：(url-decode s) 按 decodeURIComponent 解码；非法序列安全回退为原串。例 (url-decode "a%20b") => "a b"');

  // ===== 自驱循环新增内置（ci379 ~ ci395）=====
  // ---- ci379 函数组合批：pipe / curry（compose / partial / identity 已存在）----
  def('pipe', (...fns)=> (...args)=> {
    if(fns.length === 0) return args.length === 1 ? args[0] : args;
    let acc = applyFn(fns[0], args);
    for(let i = 1; i < fns.length; i++) acc = applyFn(fns[i], [acc]);
    return acc;
  }, '左到右函数组合：(pipe f g h) 返回新函数，依次用 f、g、h 传递结果(等价于 (compose h g f))；零参时返回恒等函数。例 ((pipe (lambda(x)(+ x 1)) (lambda(x)(* x 2))) 3) => 8');
  def('curry', (fn, arity)=> {
    const n = (arity == null) ? (typeof fn === 'function' && fn.length ? fn.length : 1) : Math.max(1, Number(arity) | 0);
    const acc = [];
    const step = (...args)=> { acc.push(...args); if(acc.length >= n){ const a = acc.splice(0, n); return applyFn(fn, a); } return step; };
    return step;
  }, '柯里化：(curry f n) 返回累积参数的函数，凑满 n 个参数即调用 f；n 省略时取 f 的形参个数(对 Sibilant lambda 建议显式给 n)。例 ((curry (lambda(a b c)(+ a b c)) 3) 1 2 3) => 6、(((curry + 3) 1) 2 3) => 6');

  // ---- ci383 数学扩展批：map-range（lerp / clamp / round-to / sign 已存在）----
  def('map-range', (v, inLo, inHi, outLo, outHi)=> {
    const a = Number(v), il = Number(inLo), ih = Number(inHi), ol = Number(outLo), oh = Number(outHi);
    if(!isFinite(a) || !isFinite(il) || !isFinite(ih) || !isFinite(ol) || !isFinite(oh)) return null;
    if(ih === il) return ol;
    return ol + (a - il) / (ih - il) * (oh - ol);
  }, '区间映射：(map-range v inLo inHi outLo outHi) 把 v 从 [inLo,inHi] 线性映射到 [outLo,outHi]；输入区间退化(=)时返回 outLo；任一参数非有限返回 null。例 (map-range 5 0 10 0 100) => 50');

  // ---- ci387 列表扩展批：chunk / flatten-once（take / drop / interleave 已存在）----
  def('chunk', (l, n)=> {
    if(!Array.isArray(l)) return [];
    const k = Math.trunc(Number(n));
    if(!isFinite(k) || k <= 0) return [];
    const out = [];
    for(let i = 0; i < l.length; i += k) out.push(l.slice(i, i + k));
    return out;
  }, '定长分块：(chunk xs n) 把列表每 n 个切为一组(末组可不足 n)；n<=0 或非有限返回空列表。例 (chunk (list 1 2 3 4 5) 2) => ((1 2) (3 4) (5))');
  def('flatten-once', (l)=> {
    if(!Array.isArray(l)) return [];
    const out = [];
    for(const x of l){ if(Array.isArray(x)) for(const e of x) out.push(e); else out.push(x); }
    return out;
  }, '单层展平：(flatten-once xs) 仅把直接子列表展平一层，不递归。例 (flatten-once (list 1 (list 2 3) (list 4))) => (1 2 3 4)、(flatten-once (list 1 (list (list 2)))) => (1 (2))');

  // ---- ci391 逻辑批：and? / or? / not? / xor? / implies?（严格布尔谓词）----
  def('and?', (a, b)=> !(a === false || a === null) && !(b === false || b === null), '逻辑与谓词(严格布尔)：(and? a b) 仅当 a、b 均非 false/null 时为真。例 (and? #t #t) => #t、(and? #t #f) => #f');
  def('or?', (a, b)=> !(a === false || a === null) || !(b === false || b === null), '逻辑或谓词(严格布尔)：(or? a b) 当 a、b 任一非 false/null 时为真。例 (or? #f #t) => #t、(or? #f #f) => #f');
  def('not?', (x)=> (x === false || x === null), '逻辑非谓词(严格布尔)：(not? x) 当 x 为 false 或 null 时为真。例 (not? #f) => #t、(not? 5) => #f');
  def('xor?', (a, b)=> (!(a === false || a === null)) !== (!(b === false || b === null)), '异或谓词(严格布尔)：(xor? a b) 恰有一个为真时为真。例 (xor? #t #f) => #t、(xor? #t #t) => #f');
  def('implies?', (a, b)=> (a === false || a === null) || !(b === false || b === null), '蕴含谓词(严格布尔)：(implies? a b) 表示 a→b，仅当 a 真而 b 假时为假。例 (implies? #t #f) => #f、(implies? #f #t) => #t');

  // ---- ci395 IO/JSON 批：json-parse / json-stringify / slurp（read-file / write-file 已存在）----
  def('json-parse', (s)=> { try { return jsonDec(JSON.parse(String(s))); } catch(e){ return null; } }, 'JSON 解析(容错)：(json-parse s) 把 JSON 字符串解析为 Sibilant 值（数组→列表、对象→Dict）；解析失败返回 null。例 (dict-get (json-parse "{\\"a\\":1}") "a") => 1');
  def('json-stringify', (v)=> { try { return JSON.stringify(jsonEnc(v)); } catch(e){ return null; } }, 'JSON 序列化(容错)：(json-stringify v) 把 Sibilant 值编码为 JSON 字符串；编码失败返回 null。例 (json-stringify (list 1 2)) => "[1,2]"');
  def('slurp', (p)=> { const R = (typeof require === 'function') ? require : (typeof globalThis !== 'undefined' ? globalThis.require : undefined); if(typeof R !== 'function') return null; try { return R('fs').readFileSync(String(p), 'utf8'); } catch(e){ return null; } }, '读文件为字符串(容错)：(slurp p) 读取文本文件内容；文件不存在/不可读时返回 null（比 read-file 更宽容）。例 (> (string-length (slurp "interpreter.js")) 0) => #t');

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
(define partition (lambda (n xs) (if (or (null? xs) (<= n 0)) (list) (cons (take xs n) (partition n (drop xs n))))))
(define take-while (lambda (p xs) (if (or (null? xs) (not (p (car xs)))) (list) (cons (car xs) (take-while p (cdr xs))))))
(define drop-while (lambda (p xs) (if (or (null? xs) (not (p (car xs)))) xs (drop-while p (cdr xs)))))
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
