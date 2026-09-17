/* Sibilant 使用说明面板
 * 自包含组件：只注入自己的 DOM 与样式，不读写任何业务变量、不改动渲染逻辑。
 * 打开：右下角「?」按钮 / 键盘 ? / F1        关闭：Esc / 点遮罩 / 右上角 ×
 * 首次访问自动展开一次（localStorage 记住，之后不再自动弹）。
 */
(function () {
  'use strict';

  var STORE_KEY = 'sibilant.help.seen.v1';
  var TITLE = 'Sibilant 使用说明';
  var SUBTITLE = '自研 Lisp 方言 · 解释器 REPL';

  var SECTIONS = [
    {
      h: '这是什么',
      p: '一个跑在浏览器里的<b>自研 Lisp 解释器</b>。代码经过「词法分析 → 递归下降解析 → 树遍历求值 + 闭包作用域」三段流水线，不需要任何后端就能直接跑。',
      list: [
        '内置 <b>483 个</b>函数与大量 special form（语法糖 / 控制结构）。',
        '左侧是示例按钮，右侧是 REPL（读取-求值-打印循环）。'
      ]
    },
    {
      h: 'REPL 怎么用',
      table: [
        ['Enter', '求值当前表达式'],
        ['Shift + Enter', '换行（可以写多行代码，不立即执行）'],
        ['↑ / ↓', '翻看输入历史'],
        ['Ctrl + L', '清空输出区'],
        ['清空输出按钮', '输出区顶部一键清空'],
        ['点左侧示例', '把示例一键灌入解释器并立即求值'],
        ['结果配色', '绿色是返回值，红色是报错']
      ]
    },
    {
      h: '核心特殊形式',
      p: '这些是这门语言的「关键词」，可直接用：',
      list: [
        '<b>定义</b>：define / defn / defmacro / defstruct / defenum',
        '<b>控制流</b>：if / when / cond / and / or / case / match',
        '<b>绑定</b>：let / let* / letrec / loop',
        '<b>函数</b>：lambda',
        '<b>副作用</b>：set! / begin',
        '<b>引用与宏</b>：quote / quasiquote（&#96; 反引号、, 反引用、,@ 反引用拼接、&amp; 变参）',
        '<b>循环</b>：while / for / dotimes / par（并发）',
        '<b>错误</b>：try / catch（error 主动抛错）',
        '<b>元编程</b>：eval',
        '<b>线程宏</b>：-&gt; / -&gt;&gt; / some-&gt; / cond-&gt; 等'
      ]
    },
    {
      h: '几个值得一试的示例',
      table: [
        ['递归 · 阶乘', '(define (fact n) (if (= n 0) 1 (* n (fact (- n 1)))))'],
        ['map / filter / reduce', '高阶函数组合处理列表'],
        ['宏 · when', 'defmacro + quasiquote 实现条件执行'],
        ['尾递归 · 十万次累加', '尾调用由 trampoline 展开，不爆栈'],
        ['错误回溯 / 错误定位', '运行时异常带调用链，并标注【行 N】与源码片段'],
        ['try / catch · eval', '捕获异常、把字符串当代码求值']
      ]
    },
    {
      h: '这门语言的特色',
      list: [
        '<b>尾递归优化</b>：尾部自我调用会被 trampoline 展开，跑十万次累加也不栈溢出。',
        '<b>错误回溯</b>：异常携带完整调用链；尾调用链会被压平，便于定位。',
        '<b>错误定位</b>：解析 / 运行时报错会标注 <code>【行 N】</code> 并回显该行源码片段。',
        '<b>宏</b>：用 quasiquote 在编译期改写代码，能力接近 Common Lisp。',
        '<b>异常处理</b>：try / catch 捕获并绑定错误信息，error 主动抛错。'
      ]
    },
    {
      h: '命令行也能跑',
      p: '项目里的 <code>run.js</code> 让同一套解释器在 Node 里运行：',
      table: [
        ['node run.js', '进入交互式 REPL（输入 (exit) 退出）'],
        ['node run.js -e "(+ 1 2)"', '单行求值，打印结果'],
        ['node run.js file.lisp', '运行脚本文件，打印最后一个表达式结果']
      ]
    },
    {
      h: '小贴士',
      table: [
        ['括号要配平', 'S 表达式是括号语言，少一个 ) 会报「未闭合」'],
        ['多行代码', '用 Shift + Enter 换行，最后一行的 Enter 才整体求值'],
        ['想看 JSON', '用 (json ...) 相关函数把数据序列化']
      ]
    }
  ];

  /* ---------------- 以下为通用渲染逻辑（与各应用一致） ---------------- */

  function css() {
    return [
      '.wbh-fab{position:fixed;right:18px;bottom:18px;width:42px;height:42px;border-radius:50%;',
      'background:rgba(20,26,34,.92);color:#c792ea;border:1px solid #2b3742;font:600 19px/1 ui-monospace,Menlo,Consolas,monospace;',
      'cursor:pointer;z-index:99998;display:flex;align-items:center;justify-content:center;',
      'box-shadow:0 6px 20px rgba(0,0,0,.45);transition:.16s;}',
      '.wbh-fab:hover{background:#16202b;color:#e0b6ff;transform:translateY(-2px);border-color:#c792ea;}',
      '.wbh-mask{position:fixed;inset:0;background:rgba(4,7,11,.72);backdrop-filter:blur(3px);',
      'z-index:99999;display:none;align-items:center;justify-content:center;padding:26px;}',
      '.wbh-mask.on{display:flex;}',
      '.wbh-box{background:#11151c;border:1px solid #263140;border-radius:14px;max-width:760px;width:100%;',
      'max-height:84vh;overflow:auto;color:#cdd6e0;font:13.5px/1.72 ui-sans-serif,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
      'box-shadow:0 24px 70px rgba(0,0,0,.6);position:relative;}',
      '.wbh-hd{position:sticky;top:0;background:linear-gradient(180deg,#141a23,#11151c);padding:18px 22px 13px;',
      'border-bottom:1px solid #202a36;display:flex;align-items:baseline;gap:10px;}',
      '.wbh-hd h2{margin:0;font-size:18px;color:#eaf2f8;letter-spacing:.5px;}',
      '.wbh-hd .sub{font-size:12px;color:#6d7d8d;}',
      '.wbh-x{position:absolute;right:14px;top:13px;width:28px;height:28px;border-radius:7px;background:transparent;',
      'border:1px solid #2b3742;color:#8b9aa8;cursor:pointer;font-size:15px;line-height:1;}',
      '.wbh-x:hover{background:#1b2530;color:#e6f2f8;}',
      '.wbh-bd{padding:6px 22px 22px;}',
      '.wbh-sec{margin-top:19px;}',
      '.wbh-sec h3{margin:0 0 7px;font-size:13.5px;color:#c792ea;letter-spacing:.6px;',
      'display:flex;align-items:center;gap:8px;}',
      '.wbh-sec h3::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,#22303c,transparent);}',
      '.wbh-sec p{margin:0 0 8px;color:#a9b8c6;}',
      '.wbh-sec ul{margin:0;padding-left:19px;color:#a9b8c6;}',
      '.wbh-sec li{margin:4px 0;}',
      '.wbh-sec b{color:#dce8f2;font-weight:600;}',
      '.wbh-t{width:100%;border-collapse:collapse;margin:2px 0 4px;}',
      '.wbh-t td{padding:6px 10px;border-bottom:1px solid #1c2530;vertical-align:top;color:#a9b8c6;}',
      '.wbh-t tr:last-child td{border-bottom:none;}',
      '.wbh-t td:first-child{width:34%;color:#dce8f2;font-weight:600;white-space:nowrap;}',
      '.wbh-bd code{background:#0b0f14;border:1px solid #1f2a35;border-radius:4px;padding:1px 6px;',
      'font:12px ui-monospace,Menlo,Consolas,monospace;color:#c792ea;}',
      '.wbh-ft{margin-top:22px;padding-top:13px;border-top:1px solid #1c2530;color:#5f6f7e;font-size:12px;}',
      '@media(max-width:640px){.wbh-t td:first-child{width:42%;white-space:normal;}}',
      /* 首次访问的「非阻塞」提示条：仅占底部一小条，绝不覆盖画布/侧栏/聊天，永不锁死应用 */
      '.wbh-hint{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99997;',
      'display:flex;align-items:center;gap:10px;background:rgba(17,21,28,.96);color:#cdd6e0;',
      'border:1px solid #2b3742;border-radius:10px;padding:10px 14px;',
      'font:13px ui-sans-serif,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
      'box-shadow:0 8px 28px rgba(0,0,0,.5);max-width:min(90vw,640px);}',
      '.wbh-hint b{color:#c792ea;}',
      '.wbh-hint-open{background:#c792ea22;border:1px solid #c792ea;color:#c792ea;border-radius:8px;',
      'padding:5px 12px;cursor:pointer;font-size:12px;flex:none;}',
      '.wbh-hint-open:hover{background:#c792ea33;}',
      '.wbh-hint-x{background:transparent;border:1px solid #2b3742;color:#8b9aa8;border-radius:6px;',
      'width:26px;height:26px;cursor:pointer;font-size:14px;line-height:1;flex:none;}',
      '.wbh-hint-x:hover{background:#1b2530;color:#e6f2f8;}'
    ].join('');
  }

  function esc(s) { return String(s); }

  function build() {
    var st = document.createElement('style');
    st.textContent = css();
    document.head.appendChild(st);

    var html = '<div class="wbh-box" role="dialog" aria-modal="true" aria-label="' + TITLE + '">' +
      '<div class="wbh-hd"><h2>' + TITLE + '</h2><span class="sub">' + SUBTITLE + '</span></div>' +
      '<button class="wbh-x" title="关闭 (Esc)">&times;</button><div class="wbh-bd">';

    SECTIONS.forEach(function (s) {
      html += '<div class="wbh-sec"><h3>' + esc(s.h) + '</h3>';
      if (s.p) html += '<p>' + s.p + '</p>';
      if (s.list) {
        html += '<ul>';
        s.list.forEach(function (li) { html += '<li>' + li + '</li>'; });
        html += '</ul>';
      }
      if (s.table) {
        html += '<table class="wbh-t"><tbody>';
        s.table.forEach(function (r) { html += '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; });
        html += '</tbody></table>';
      }
      if (s.p2) html += '<p>' + s.p2 + '</p>';
      html += '</div>';
    });

    html += '<div class="wbh-ft">随时按 <code>?</code> 或 <code>F1</code> 再次打开本说明 · <code>Esc</code> 关闭</div>';
    html += '</div></div>';

    var mask = document.createElement('div');
    mask.className = 'wbh-mask';
    mask.innerHTML = html;
    document.body.appendChild(mask);

    var fab = document.createElement('button');
    fab.className = 'wbh-fab';
    fab.textContent = '?';
    fab.title = '使用说明 (? 或 F1)';
    document.body.appendChild(fab);

    function open() { mask.classList.add('on'); }
    function close() { mask.classList.remove('on'); }
    function toggle() { mask.classList.contains('on') ? close() : open(); }

    fab.addEventListener('click', open);
    mask.querySelector('.wbh-x').addEventListener('click', close);
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });

    document.addEventListener('keydown', function (e) {
      var t = e.target, tag = t && t.tagName;
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
      if (e.key === 'Escape' && mask.classList.contains('on')) { close(); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?' || e.key === 'F1') { e.preventDefault(); toggle(); }
    });

    try {
      if (!localStorage.getItem(STORE_KEY)) { firstVisitHint(); localStorage.setItem(STORE_KEY, '1'); }
    } catch (_) { /* 隐私模式下 localStorage 不可用，忽略 */ }

    // 首次访问提示：非阻塞小条，绝不弹出全屏遮罩锁死应用；点击可主动打开完整说明。
    function firstVisitHint() {
      var bar = document.createElement('div');
      bar.className = 'wbh-hint';
      bar.innerHTML = '<span>📖 首次使用 Sibilant？点击右下角 <b>?</b> 随时查看完整使用说明</span>' +
        '<button class="wbh-hint-open" type="button">查看说明</button>' +
        '<button class="wbh-hint-x" type="button" title="不再提示">&times;</button>';
      document.body.appendChild(bar);
      var openBtn = bar.querySelector('.wbh-hint-open');
      var closeBtn = bar.querySelector('.wbh-hint-x');
      if (openBtn) openBtn.addEventListener('click', function () { open(); if (bar.parentNode) bar.parentNode.removeChild(bar); });
      if (closeBtn) closeBtn.addEventListener('click', function () { if (bar.parentNode) bar.parentNode.removeChild(bar); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
