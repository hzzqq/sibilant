#!/usr/bin/env bash
# === Sibilant Lisp 方言 启动脚本（Git Bash / macOS / Linux）===
#   ./start.sh                 交互式 REPL
#   ./start.sh -e "(+ 1 2)"    求值单行表达式
#   ./start.sh examples/x.lisp 运行脚本文件
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "[错误] 未找到 Node.js，请先安装：https://nodejs.org"; exit 1; }

echo "=== Sibilant Lisp REPL ==="
echo "输入表达式回车求值；(exit) 或 Ctrl+C 退出。"
echo "浏览器 REPL：直接打开 index.html 即可（普通脚本，file:// 可运行）。"
echo
node "$(dirname "$0")/run.js" "$@"
