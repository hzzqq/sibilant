// ci119 Sibilant 类型谓词批 —— 行为测试
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, 'interpreter.js'), 'utf8'))();
const { run, lispStr } = global.window.Sibilant;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };
const eq = (n, expr, want) => {
  let r; try { r = run(expr); } catch(e){ fail++; console.log('  FAIL', n, '->', e.message); return; }
  ok(n + '  => ' + lispStr(r), JSON.stringify(lispStr(r)) === JSON.stringify(want));
};
const T = '#t', F = '#f';

// float?：带小数为真，整数/非数字为假
eq('float? 3.5', '(float? 3.5)', T);
eq('float? -0.25', '(float? -0.25)', T);
eq('float? 3 (整数)', '(float? 3)', F);
eq('float? "x"', '(float? "x")', F);

// pos? / neg?：正负判定，0 两者皆否
eq('pos? 5', '(pos? 5)', T);
eq('pos? -3', '(pos? -3)', F);
eq('pos? 0', '(pos? 0)', F);
eq('neg? -3', '(neg? -3)', T);
eq('neg? 5', '(neg? 5)', F);
eq('neg? 0', '(neg? 0)', F);

// bool?：布尔为真，数字为假
eq('bool? #t', '(bool? #t)', T);
eq('bool? #f', '(bool? #f)', T);
eq('bool? 0', '(bool? 0)', F);

// function?：原生函数与 lambda 为真，数字为假
eq('function? +', '(function? +)', T);
eq('function? lambda', '(function? (lambda (x) x))', T);
eq('function? 5', '(function? 5)', F);

// nil?：空列表/null 为真
eq('nil? ()', '(nil? ())', T);
eq('nil? 5', '(nil? 5)', F);

// empty?：空列表 / 空字符串 / null 为真
eq('empty? ()', '(empty? ())', T);
eq('empty? ""', '(empty? "")', T);
eq('empty? "x"', '(empty? "x")', F);
eq('empty? (1)', '(empty? (list 1))', F);

// 文档登记
ok('doc float? 含「浮点数」', run('(doc (quote float?))').indexOf('浮点数') >= 0);
ok('doc function? 含「函数」', run('(doc (quote function?))').indexOf('函数') >= 0);
ok('doc empty? 含「空」', run('(doc (quote empty?))').indexOf('空') >= 0);

console.log(`\nci119 predicates: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
