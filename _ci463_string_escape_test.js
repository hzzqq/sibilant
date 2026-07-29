// ci463 回归：tokenizer 字符串转义序列此前被"吞掉反斜杠"——源码 "a\nb" 得到 "anb"（字母n），
// 连 split-lines 自己的文档示例都是坏的；未闭合字符串被静默接受；lispStr 打印字符串不转义，
// 含引号/换行的字符串无法读-打印往返。本测试锁定三处修复。
const fs = require('fs');
const path = require('path');
global.window = {};
global.require = require;
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const S = global.window.Sibilant;
const run = (s) => S.run(s);

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.error('FAIL ' + n); } };

// ---- 1. 转义序列正确翻译 ----
ok('\\n -> 换行', run('"a\\nb"') === 'a\nb');
ok('\\t -> 制表', run('"a\\tb"') === 'a\tb');
ok('\\r -> 回车', run('"a\\rb"') === 'a\rb');
ok('\\\\ -> 单反斜杠', run('"a\\\\b"') === 'a\\b');
ok('\\" -> 引号', run('"say \\" hi"') === 'say " hi');

// ---- 2. 未知转义保留反斜杠（正则可直接书写）----
ok('未知转义 \\d 保留', run('"\\d+"') === '\\d+');
ok('re-matches 用 \\d', S.lispStr(run('(re-matches "^\\d+$" "123")')) === '("123")');
ok('re-replace 用 \\d', run('(re-replace "\\d" "a1b2" "#")') === 'a#b#' || run('(re-replace "a1b2" "\\d" "#")') === 'a#b#');
ok('regex-find-all 用 \\w+', JSON.stringify(run('(regex-find-all "\\w+" "hi there")')) === '["hi","there"]');

// ---- 3. split-lines 文档示例复活 ----
ok('split-lines "a\\nb"', JSON.stringify(run('(split-lines "a\\nb")')) === '["a","b"]');
ok('split-lines 真实换行仍可用', JSON.stringify(run('(split-lines "a\nb")')) === '["a","b"]');

// ---- 4. 未闭合字符串报错（带行号）----
let e1 = null; try { run('"abc'); } catch (e) { e1 = e; }
ok('未闭合字符串抛错', e1 && /未闭合/.test(e1.message));
let e2 = null; try { run('(+ 1 2)\n(+ 3 4)\n"oops'); } catch (e) { e2 = e; }
ok('未闭合错误行号=3', e2 && e2.line === 3);

// ---- 5. lispStr 读-打印往返 ----
ok('lispStr 转义换行', S.lispStr('a\nb') === '"a\\nb"');
ok('lispStr 转义引号+反斜杠', S.lispStr('a"b\\c') === '"a\\"b\\\\c"');
const tricky = 'x"y\nz\t\\w';
ok('往返: parse(lispStr(v)) == v', run(S.lispStr(tricky)) === tricky);
ok('列表内字符串往返', S.lispStr(run('(list "a\\nb" "c\\"d")')) === '("a\\nb" "c\\"d")');

// ---- 6. 行为回归：多行字符串行号推进正确 ----
let e3 = null; try { run('"line1\nline2"\n(undefined-sym-xyz)'); } catch (e) { e3 = e; }
ok('多行字符串后报错行号=3', e3 && e3.line === 3);

// ---- 7. 源码接线审计：防未来回退 ----
const src = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
ok('tokenize 含未闭合守卫', /未闭合的字符串/.test(src));
ok('tokenize 含未知转义保留分支', src.includes("s += '\\\\' + e"));

console.log(`\nci463 string escape + unterminated + lispStr roundtrip: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
