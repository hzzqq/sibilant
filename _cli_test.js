// Sibilant CLI 测试：验证 run.js 的三种调用方式（文件 / -e / REPL 通过 -e 模拟）。
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('  FAIL', name); } }
function runCli(args){
  return execFileSync(process.execPath, [path.join(__dirname, 'run.js'), ...args], { encoding: 'utf8' });
}

// 1) 运行脚本文件：fib.lisp 末行 (sum-to 100 0) = 5050（print 会先输出一行，取末行）
const outFile = runCli([path.join(__dirname, 'examples', 'fib.lisp')]).trim().split('\n').pop();
ok('CLI 文件模式 末值=5050', outFile === '5050');

// 2) -e 单行求值
const outEval = runCli(['-e', '(+ 1 2 3)']).trim();
ok('CLI -e 求值 =6', outEval === '6');

// 3) -e 触发错误时退出码非 0 且带行号（第 2 行未定义符号）
let errored = false, msg = '';
try { runCli(['-e', '(+ 1 2)\nfoo']); } catch(e){ errored = true; msg = e.stderr || e.stdout || ''; }
ok('CLI 运行时错误非零退出且带行号', errored && /行/.test(msg));

// 4) -e 模块/集合等高级特性可用
const outAdv = runCli(['-e', '(set-len (set 1 2 2 3))']).trim();
ok('CLI 集合去重 len=3', outAdv === '3');

// 5) 文件 IO：write-file / read-file / file-exists? / delete-file / argv（Node 环境）
const f = path.join(__dirname, '.sib_io_tmp.txt').replace(/\\/g, '/');
try {
  ok('CLI write-file 副作用', (()=>{ runCli(['-e', '(write-file "' + f + '" "hello sib")']); return fs.existsSync(f) && fs.readFileSync(f, 'utf8') === 'hello sib'; })());
  ok('CLI read-file', runCli(['-e', '(read-file "' + f + '")']).trim() === '"hello sib"');
  ok('CLI file-exists? true', runCli(['-e', '(file-exists? "' + f + '")']).trim() === '#t');
  ok('CLI file-exists? false', runCli(['-e', '(file-exists? "' + f + '_missing")']).trim() === '#f');
  runCli(['-e', '(delete-file "' + f + '")']);
  ok('CLI delete-file 后不存在', !fs.existsSync(f));
  ok('CLI argv 是列表', runCli(['-e', '(list? (argv))']).trim() === '#t');
} finally { try { fs.unlinkSync(f); } catch(e){} }

console.log('[cli] pass=' + pass + ' fail=' + fail);
if(fail > 0) process.exit(1);
