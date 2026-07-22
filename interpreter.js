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
  def('sum', (l)=> Array.isArray(l) ? l.reduce((a, x)=> a + (Number(x) || 0), 0) : 0, '数值列表求和：(sum xs) 将列表中每个元素当作数字相加(非数字按 0 处理)；空列表返回 0。例 (sum (list 1 2 3 4)) => 10');
  def('product', (l)=> Array.isArray(l) ? l.reduce((a, x)=> a * (Number(x) || 0), 1) : 1, '数值列表求积：(product xs) 将列表中每个元素当作数字连乘(非数字按 0 处理)；空列表返回 1。例 (product (list 2 3 4)) => 24');
  def('mean', (l)=> { if(!Array.isArray(l) || l.length === 0) return 0; const s = l.reduce((a,x)=> a + (Number(x)||0), 0); return s / l.length; }, '算术平均值：(mean xs) 返回数值列表的算术平均；空列表返回 0。例 (mean (list 1 2 3 4)) => 2.5');
  def('median', (l)=> { if(!Array.isArray(l) || l.length === 0) return 0; const a = l.map(x=>Number(x)||0).sort((p,q)=> p-q); const n = a.length, m = n>>1; return n % 2 ? a[m] : (a[m-1] + a[m]) / 2; }, '中位数：(median xs) 升序排序后取中间值；偶数个元素取中间两数的平均。例 (median (list 3 1 2)) => 2、(median (list 4 1 3 2)) => 2.5');
  def('variance', (l)=> { if(!Array.isArray(l) || l.length < 2) return 0; const a = l.map(x=>Number(x)||0); const m = a.reduce((s,x)=> s+x,0)/a.length; return a.reduce((s,x)=> s+(x-m)*(x-m),0)/(a.length-1); }, '样本方差（无偏，除以 n-1）：(variance xs) 返回数值列表的样本方差；元素不足 2 个返回 0。例 (variance (list 2 4 4 4 5 5 7 9)) ≈ 4.571');
  def('stdev', (l)=> Math.sqrt((Array.isArray(l) && l.length >= 2) ? (()=>{ const a=l.map(x=>Number(x)||0); const m=a.reduce((s,x)=>s+x,0)/a.length; return a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1); })() : 0), '样本标准差：(stdev xs) 即 (sqrt (variance xs))；元素不足 2 个返回 0。例 (stdev (list 2 4 4 4 5 5 7 9)) ≈ 2.138');
  def('clamp', (x, lo, hi)=> { const a = Number(x), b = Number(lo), c = Number(hi); return Math.min(Math.max(a, b), c); }, '将数值限制在闭区间 [lo, hi] 内：(clamp x lo hi) 当 x<lo 取 lo、x>hi 取 hi、否则取 x。例 (clamp 15 0 10) => 10、(clamp -3 0 10) => 0');
  def('lerp', (a, b, t)=> Number(a) + (Number(b) - Number(a)) * Number(t), '线性插值：(lerp a b t) 返回 a 与 b 按比例 t 插值的结果(等价于 a+(b-a)*t)。例 (lerp 0 10 0.5) => 5、(lerp 0 100 0.25) => 25');

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
  def('drop', (l, n)=> Array.isArray(l) ? l.slice(n) : []);
  def('last', (l)=> (Array.isArray(l) && l.length) ? l[l.length-1] : null);
  def('flatten', (l)=> {
    const out = [];
    const walk = (x)=>{ if(Array.isArray(x)) x.forEach(walk); else out.push(x); };
    if(Array.isArray(l)) l.forEach(walk);
    return out;
  });
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
    if(!(a instanceof LSet) || !(b instanceof LSet)) throw lispError('superset? 需要 set');
    for(const v of b.keys()) if(!a.has(v)) return false;
    return true;
  }, '超集判定：(superset? a b) 当 b 的每一个元素都属于 a 时返回真(空集是任何集合的超集)。例 (superset? (set 1 2 3) (set 2)) => #t、(superset? (set 1) (set 1 2)) => #f');
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
    if(!(a instanceof LSet) || !(b instanceof LSet)) throw lispError('subset? 需要 set');
    for(const v of a.keys()) if(!b.has(v)) return false;
    return true;
  }, '子集判定：(subset? a b) 当 a 的每个元素都属于 b 时返回真(空集是任何集合的子集)。例 (subset? (set 1) (set 1 2)) => #t');
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
  def('cycle', (n, l)=>{ if(!Array.isArray(l)) return []; const out = [], m = Math.max(0, Math.trunc(Number(n))); for(let i = 0; i < m; i++) out.push(l[i % l.length]); return out; }, '循环取样：(cycle n l) 从 l 循环取前 n 个元素(不足则从头复用)。例 (cycle 5 (list 1 2)) => (1 2 1 2 1)');
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
