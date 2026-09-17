#!/usr/bin/env bash
# === Sibilant Lisp 方言 启动脚本（Git Bash / macOS / Linux）===
#   ./start.sh                 交互式 REPL
#   ./start.sh -e "(+ 1 2)"    求值单行表达式
#   ./start.sh examples/x.lisp 运行脚本文件
cd "$(dirname "$0")" || exit 1
NODE="C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
if [ ! -x "$NODE" ]; then
  echo "[错误] 未找到 WorkBuddy Node 运行时：$NODE"
  exit 1
fi

echo "=== Sibilant Lisp REPL ==="
echo "输入表达式回车求值；(exit) 或 Ctrl+C 退出。"
echo "浏览器 REPL：直接打开 index.html 即可（普通脚本，file:// 可运行）。"
echo
"$NODE" "$(dirname "$0")/run.js" "$@"
