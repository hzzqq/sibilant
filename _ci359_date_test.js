// ci359 — Sibilant 日期时间批次：now / today / timestamp / format-date
// 隐性修复：flatten 补 doc、flatten-deep 非数组输入改为返回空列表(与 flatten 一致)
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8');
global.window = {};
new Function(code)();

const S = global.window.Sibilant;
if (!S || typeof S.run !== 'function') {
  console.error('FAIL: Sibilant runtime not attached to window');
  process.exit(1);
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${g}, want ${w}`); }
}
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error(`FAIL ${name}`); } }
function run(src) { return S.run(src); }

// ---------- now ----------
ok('now 返回数字', typeof run('(now)') === 'number');
ok('now > 0', run('(now)') > 0);
ok('now 接近 Date.now()', Math.abs(run('(now)') - Date.now()) < 2000);

// ---------- today ----------
const jsToday = (() => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();
eq('today 格式 YYYY-MM-DD', run('(today)'), jsToday);
eq('today 长度 10', run('(string-length (today))'), 10);

// ---------- timestamp ----------
eq('timestamp (list 2020 1 1) == new Date(2020,0,1)', run('(timestamp (list 2020 1 1))'), new Date(2020, 0, 1).getTime());
eq('timestamp (list 2020 1 1 2 3 4)', run('(timestamp (list 2020 1 1 2 3 4))'), new Date(2020, 0, 1, 2, 3, 4).getTime());
eq('timestamp 数字透传', run('(timestamp 123456)'), 123456);
eq('timestamp 字符串解析', run('(timestamp "2020-01-01T00:00:00Z")'), Date.parse('2020-01-01T00:00:00Z'));
eq('timestamp 非法字符串 -> null', run('(timestamp "not-a-date")'), null);
eq('timestamp 残缺列表 -> null', run('(timestamp (list 1))'), null);
eq('timestamp 非有限 -> null', run('(timestamp "x")'), null);

// ---------- format-date ----------
eq('format-date 默认模板', run('(format-date (list 2020 1 5))'), '2020-01-05');
eq('format-date 自定义模板', run('(format-date (list 2020 1 5) "YYYY/MM/DD")'), '2020/01/05');
eq('format-date 含时分秒', run('(format-date (list 2020 1 5 2 3 4) "YYYY-MM-DD HH:mm:ss")'), '2020-01-05 02:03:04');
eq('format-date 数字(ms) 也支持', run('(format-date 0)'), '1970-01-01');
eq('format-date 非法字符串 -> 空串', run('(format-date "xyz")'), '');
eq('format-date 残缺列表 -> 空串', run('(format-date (list 1))'), '');

// ---------- 隐性修复验证 ----------
eq('扁平 flatten 文档存在', typeof run('(doc "flatten")') === 'string' && run('(doc "flatten")') !== null, true);
eq('flatten-deep 非数组 -> 空列表', run('(flatten-deep 5)'), []);
eq('flatten-deep 嵌套仍正确', run('(flatten-deep (list 1 (list 2 (list 3 4)) 5))'), [1, 2, 3, 4, 5]);
eq('flatten 非数组 -> 空列表', run('(flatten 5)'), []);
eq('flatten 嵌套正确', run('(flatten (list 1 (list 2 3)))'), [1, 2, 3]);

console.log(`ci359(date): pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
