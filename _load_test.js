// ci123 Sibilant load 内置 —— 行为测试
const fs = require('fs');
const path = require('path');
global.window = {};
// 注入 require，使解释器内 read-file / load 等 Node 文件 IO 可用
const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
new Function('require', code)(require);
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };
const eq = (n, expr, want) => {
  let r; try { r = run(expr); } catch(e){ fail++; console.log('  FAIL', n, '->', e.message); return; }
  ok(n + '  => ' + lispStr(r), JSON.stringify(lispStr(r)) === JSON.stringify(want));
};

// 写一个临时 .lisp 文件
const tmp = path.join(__dirname, '.load_tmp.lisp');
fs.writeFileSync(tmp, '(define loaded-val 99)\n(+ 1 2 3)\n');
// 路径含反斜杠时需转义，避免被 Lisp 字符串解析为转义序列
const tmpEsc = tmp.replace(/\\/g, '\\\\');

// 载入文件：文件内 define 注入当前环境，后续代码可见
eq('load 后 loaded-val 可见', '(load "' + tmpEsc + '") loaded-val', '99');
// load 返回文件最后一个表达式的值（1+2+3=6）
eq('load 返回文件末值', '(load "' + tmpEsc + '")', '6');
// load 注入的定义可在同一环境继续运算
eq('load 注入定义可运算', '(load "' + tmpEsc + '") (+ loaded-val 1)', '100');
// 多次 load：定义被覆盖（再次 define 同名为新值）
fs.writeFileSync(tmp, '(define loaded-val 7)\n');
eq('二次 load 覆盖定义', '(load "' + tmpEsc + '") loaded-val', '7');

// 载入不存在的文件应抛错
let threw = false;
try { run('(load ".nope_missing.lisp")'); } catch(e){ threw = true; }
ok('载入不存在文件抛错', threw);

// 文档登记
ok('doc load 含「载入」', run('(doc (quote load))').indexOf('载入') >= 0);

// 清理临时文件
try { fs.unlinkSync(tmp); } catch(e){}
console.log(`\nci123 load: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
