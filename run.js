#!/usr/bin/env node
// Sibilant 命令行入口：
//   node run.js                 -> 交互式 REPL
//   node run.js -e "(+ 1 2)"    -> 求值单行表达式
//   node run.js file.lisp       -> 运行脚本文件，打印最后一个表达式的结果
// 以与浏览器一致的方式加载解释器（解释器通过 window.Sibilant 暴露 API）。
const fs = require('fs');
const path = require('path');
const readline = require('readline');

global.window = global.window || {};
// 解释器经 new Function 加载，运行在全局作用域，看不到本模块的 require/process；
// 这里显式挂到 globalThis，使 Node 文件 IO 内置在解释器内可用（浏览器无此全局，自动降级）。
globalThis.require = require;
globalThis.process = process;
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

function printResult(r){ if(r !== undefined) console.log(lispStr(r)); }

const argv = process.argv.slice(2);

if(argv.length === 0){
  // ---- 交互式 REPL ----
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'sibilant> ' });
  console.log('Sibilant REPL — 输入表达式，Ctrl+C 或 (exit) 退出');
  rl.prompt();
  rl.on('line', (line) => {
    const src = line.trim();
    if(src === '') { rl.prompt(); return; }
    if(src === '(exit)' || src === '(quit)') { rl.close(); return; }
    try { printResult(run(src, undefined, '<repl>')); }
    catch(e){ console.log(e.message); }
    rl.prompt();
  });
  rl.on('close', () => { console.log('再见。'); process.exit(0); });
} else if(argv[0] === '-e'){
  // ---- 单行求值 ----
  const src = argv.slice(1).join(' ');
  try { printResult(run(src, undefined, '<eval>')); }
  catch(e){ console.log(e.message); process.exit(1); }
} else {
  // ---- 脚本文件 ----
  const file = argv[0];
  try {
    const src = fs.readFileSync(file, 'utf8');
    printResult(run(src, undefined, file));
  } catch(e){
    console.log(e.message);
    process.exit(1);
  }
}
