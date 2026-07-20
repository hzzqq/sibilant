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

// 运行时调用栈（用于错误回溯）。每次进入/离开一个过程时 push/pop 标签。
let callStack = [];
function lispError(msg, loc){
  const e = new Error(msg);
  e.lisp = true;
  const ln = nodeLine(loc);
  if(ln != null) e.line = ln;        // 报错所在行号
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
  fn.params.forEach((p, i) => ne.vars[p.name] = args[i]);
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
  m.params.forEach((p, i) => ne.vars[p.name] = rawArgs[i]);
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
      case 'quasiquote': return ev(qq(node[1]), env, tail);
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
      case 'lambda': return makeLambda(node[1], node.slice(2), env);
      case 'let': {
        const ne = makeEnv(env);
        for(const b of node[1]) ne.vars[b[0].name] = ev(b[1], env, false);
        return evalBodyTCO(node.slice(2), ne, tail);
      }
      case 'let*': {
        let ne = env;
        for(const b of node[1]){
          const inner = makeEnv(ne);
          inner.vars[b[0].name] = ev(b[1], ne, false);
          ne = inner;
        }
        return evalBodyTCO(node.slice(2), ne, tail);
      }
      case 'letrec': {       // 互递归绑定：先预占位，再按序求值（lambda 可互相引用）
        const ne = makeEnv(env);
        for(const b of node[1]) ne.vars[b[0].name] = undefined;
        for(const b of node[1]) ne.vars[b[0].name] = ev(b[1], ne, false);
        return evalBodyTCO(node.slice(2), ne, tail);
      }
      case 'loop': {
        const fname = node[1].name;
        const binds = node[2];
        const bodyForms = node.slice(3);
        const ne = makeEnv(env);
        const params = binds.map(b => new Sym(b[0].name));
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

// ---- 内置函数 ----
function setupBuiltins(env){
  const def = (n, f) => env.vars[n] = f;
  def('+', (...a)=> a.reduce((x,y)=>x+y, 0));
  def('-', (a,...r)=> r.length ? r.reduce((x,y)=>x-y, a) : -a);
  def('*', (...a)=> a.reduce((x,y)=>x*y, 1));
  def('/', (a,...r)=> r.length ? r.reduce((x,y)=>x/y, a) : 1/a);
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
  def('eq?', (a,b)=> a===b);
  def('mod', (a,b)=> ((a%b)+b)%b);
  def('sqrt', (a)=> Math.sqrt(a));
  def('abs', (a)=> Math.abs(a));
  def('print', (...a)=> a.map(lispStr).join(' '));
  def('range', (n)=> { const r=[]; for(let i=0;i<n;i++) r.push(i); return r; });
  def('length', (x)=> Array.isArray(x) ? x.length : (typeof x==='string' ? x.length : 0));
  def('map', (f,l)=> Array.isArray(l) ? l.map(x=>applyFn(f,[x])) : []);
  def('filter', (f,l)=> Array.isArray(l) ? l.filter(x=>applyFn(f,[x])) : []);
  def('reduce', (f,init,l)=> Array.isArray(l) ? l.reduce((a,x)=>applyFn(f,[a,x]), init) : init);
  def('apply', (f,l)=> applyFn(f, Array.isArray(l)?l:[]));

  // ---- 序列折叠 / 压缩 ----
  def('foldl', (f, init, l)=> Array.isArray(l) ? l.reduce((a,x)=>applyFn(f,[a,x]), init) : init);
  def('foldr', (f, init, l)=> Array.isArray(l) ? l.reduceRight((a,x)=>applyFn(f,[x,a]), init) : init);
  def('for-each', (f, l)=>{ if(Array.isArray(l)) l.forEach(x=>applyFn(f,[x])); return null; });
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
  return String(v);
}

// ---- 对外 API ----
function newEnv(){ const e = makeEnv(null); setupBuiltins(e); return e; }
function srcLineAt(src, line){
  const parts = src.split('\n');
  return (line >= 1 && line <= parts.length) ? parts[line-1].trim() : '';
}
function run(src, env){
  env = env || newEnv();
  const exprs = parseAll(src);
  let r = null;
  try {
    for(const e of exprs) r = resolveTail(ev(e, env, true));
  } catch(err){
    if(err && err.lisp){
      let msg = err.message;
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
