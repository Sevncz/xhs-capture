#!/usr/bin/env bash
# Install fixed entry points under ~/.local/bin so Shortcuts can use a portable path:
#   "$HOME/.local/bin/xhs-capture-shortcut"
#
# Does NOT install Node/Chrome. Does NOT create the macOS Shortcut itself.
# Re-run after git pull if you used symlink mode (default).
set -euo pipefail

resolve_script_root() {
  local src="${BASH_SOURCE[0]:-$0}"
  while [[ -L "$src" ]]; do
    local dir
    dir="$(cd "$(dirname "$src")" && pwd)"
    src="$(readlink "$src")"
    [[ "$src" != /* ]] && src="$dir/$src"
  done
  cd "$(dirname "$src")" && pwd
}

ROOT="$(resolve_script_root)"
HOME_DIR="${HOME:-$(cd ~ && pwd)}"
PREFIX="${XHS_CAPTURE_PREFIX:-$HOME_DIR/.local}"
BINDIR="${XHS_CAPTURE_BINDIR:-$PREFIX/bin}"
MODE="symlink" # symlink | copy
DO_UNINSTALL=0

usage() {
  cat <<EOF
用法:
  ./install.sh              安装到 ~/.local/bin（默认 symlink 到本仓库）
  ./install.sh --copy       复制一份到 ~/.local/share/xhs-capture，再链 bin
  ./install.sh --uninstall  移除已安装入口
  ./install.sh --prefix DIR 安装前缀（默认 ~/.local）

环境变量:
  XHS_CAPTURE_PREFIX   同 --prefix
  XHS_CAPTURE_BINDIR   bin 目录（默认 \$PREFIX/bin）

安装后快捷指令「运行 Shell 脚本」可贴（所有用户通用写法）:
  "\$HOME/.local/bin/xhs-capture-shortcut"
  "\$HOME/.local/bin/xhs-capture-shortcut" --deep
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --copy) MODE="copy"; shift ;;
    --symlink) MODE="symlink"; shift ;;
    --uninstall) DO_UNINSTALL=1; shift ;;
    --prefix)
      PREFIX="${2:-}"
      BINDIR="$PREFIX/bin"
      shift 2
      ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

NAMES=(xhs-capture xhs-capture-shortcut xhs-capture-doctor)

uninstall() {
  local n p
  echo "卸载入口（$BINDIR）…"
  for n in "${NAMES[@]}"; do
    p="$BINDIR/$n"
    if [[ -L "$p" || -f "$p" ]]; then
      rm -f "$p"
      echo "  removed $p"
    else
      echo "  skip (missing) $p"
    fi
  done
  local share="$PREFIX/share/xhs-capture"
  if [[ -d "$share" ]]; then
    echo "  保留数据目录（如需手动删）: $share"
  fi
  echo "完成。"
}

if [[ "$DO_UNINSTALL" -eq 1 ]]; then
  uninstall
  exit 0
fi

for f in run shortcut.sh doctor capture.mjs; do
  if [[ ! -e "$ROOT/$f" ]]; then
    echo "install: 缺少 $ROOT/$f" >&2
    exit 1
  fi
done

mkdir -p "$BINDIR"
chmod +x "$ROOT/run" "$ROOT/shortcut.sh" "$ROOT/doctor" 2>/dev/null || true

TARGET_ROOT="$ROOT"
if [[ "$MODE" == "copy" ]]; then
  TARGET_ROOT="$PREFIX/share/xhs-capture"
  mkdir -p "$TARGET_ROOT/captures"
  # 同步核心文件（不覆盖用户 captures 内容时可加 rsync exclude）
  for f in run shortcut.sh doctor capture.mjs README.md LICENSE; do
    if [[ -e "$ROOT/$f" ]]; then
      cp -f "$ROOT/$f" "$TARGET_ROOT/$f"
    fi
  done
  chmod +x "$TARGET_ROOT/run" "$TARGET_ROOT/shortcut.sh" "$TARGET_ROOT/doctor"
  # captures: 仅确保目录存在
  mkdir -p "$TARGET_ROOT/captures"
  echo "已复制到: $TARGET_ROOT"
fi

ln -sfn "$TARGET_ROOT/run" "$BINDIR/xhs-capture"
ln -sfn "$TARGET_ROOT/shortcut.sh" "$BINDIR/xhs-capture-shortcut"
ln -sfn "$TARGET_ROOT/doctor" "$BINDIR/xhs-capture-doctor"

echo "已安装 ($MODE):"
echo "  $BINDIR/xhs-capture           → $TARGET_ROOT/run"
echo "  $BINDIR/xhs-capture-shortcut  → $TARGET_ROOT/shortcut.sh"
echo "  $BINDIR/xhs-capture-doctor    → $TARGET_ROOT/doctor"
echo

# PATH 提示
case ":$PATH:" in
  *":$BINDIR:"*) echo "✓ $BINDIR 已在 PATH 中" ;;
  *)
    echo "⚠ $BINDIR 不在当前 PATH。终端可用完整路径，或把下面一行写入 ~/.zshrc："
    echo "  export PATH=\"$BINDIR:\$PATH\""
    ;;
esac

echo
echo "快捷指令「运行 Shell 脚本」请贴下面一行（勿写死 /Users/某用户）："
echo "  \"\$HOME/.local/bin/xhs-capture-shortcut\""
if [[ "$BINDIR" != "$HOME_DIR/.local/bin" ]]; then
  echo "  （你的 bin 是 $BINDIR，请改成：\"$BINDIR/xhs-capture-shortcut\"）"
fi
echo "深度保存："
echo "  \"\$HOME/.local/bin/xhs-capture-shortcut\" --deep"
echo
echo "iCloud 快捷指令模板（导入后若路径不同，改成上一行）："
echo "  https://www.icloud.com/shortcuts/de79d50eed5a47e0adc7c69ba1280ca3"
echo
echo "验证: xhs-capture-doctor   或   \"$BINDIR/xhs-capture-doctor\""
echo "卸载: ./install.sh --uninstall"
