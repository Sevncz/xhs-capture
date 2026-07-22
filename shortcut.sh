#!/usr/bin/env bash
# macOS Shortcuts / Raycast: capture + completion dialog
#
# After ./install.sh, Shortcuts can use a portable line:
#   "$HOME/.local/bin/xhs-capture-shortcut"
# Deep:
#   "$HOME/.local/bin/xhs-capture-shortcut" --deep
#
# Logs: /tmp/xhs-capture-shortcut.log
#
# Optional:
#   XHS_CAPTURE_NOTIFY=notification  — banner only (no dialog)
#   XHS_CAPTURE_NOTIFY=both          — dialog + banner (default: dialog)

set -u

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
HOME_DIR="${HOME:-/Users/wen}"
CAPTURE="$ROOT/run"
LOG="/tmp/xhs-capture-shortcut.log"
ERR="/tmp/xhs-capture-shortcut.log.err"
NOTIFY_MODE="${XHS_CAPTURE_NOTIFY:-dialog}"

export PATH="${HOME_DIR}/.n/bin:${HOME_DIR}/.npm-global/bin:${HOME_DIR}/.bun/bin:${HOME_DIR}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Same harness convenience as run
if [[ -z "${XHS_CAPTURE_ROOT:-}" ]]; then
  case "${0}" in
    *writer-workspace/scripts/xhs-capture*)
      _base="${0%writer-workspace/scripts/xhs-capture*}"
      _candidate="${_base}writer-workspace/assets/xhs-captures"
      if [[ -d "$_candidate" ]] || [[ -d "$(dirname "$_candidate")" ]]; then
        export XHS_CAPTURE_ROOT="$_candidate"
      fi
      ;;
  esac
fi

# Banner (easy to miss under Focus); kept as optional fallback
notify_banner() {
  local t s b
  t=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  s=$(printf '%s' "$2" | sed 's/\\/\\\\/g; s/"/\\"/g')
  b=$(printf '%s' "$3" | sed 's/\\/\\\\/g; s/"/\\"/g')
  /usr/bin/osascript -e "display notification \"$b\" with title \"$t\" subtitle \"$s\" sound name \"Glass\"" 2>/dev/null || true
}

# Modal dialog — visible after Shortcuts finishes (argv avoids quoting bugs)
# $1 title  $2 message  $3 path (optional, enables Finder button)
notify_dialog() {
  /usr/bin/osascript - "$1" "$2" "${3:-}" <<'APPLESCRIPT' 2>/dev/null || true
on run argv
  set dlgTitle to item 1 of argv
  set dlgMsg to item 2 of argv
  set savePath to ""
  if (count of argv) ≥ 3 then set savePath to item 3 of argv

  if savePath is not "" then
    set r to display dialog dlgMsg with title dlgTitle buttons {"好", "在 Finder 中显示"} default button 1 with icon note
    if button returned of r is "在 Finder 中显示" then
      try
        do shell script "open -R " & quoted form of savePath
      on error
        try
          do shell script "open " & quoted form of savePath
        end try
      end try
    end if
  else
    display dialog dlgMsg with title dlgTitle buttons {"好"} default button 1 with icon caution
  end if
end run
APPLESCRIPT
}

notify_user() {
  local title="$1" subtitle="$2" body="$3" path="${4:-}"
  local msg
  if [[ -n "$subtitle" ]]; then
    msg="${subtitle}
${body}"
  else
    msg="$body"
  fi

  case "$NOTIFY_MODE" in
    notification|banner)
      notify_banner "$title" "$subtitle" "$body"
      ;;
    both)
      notify_banner "$title" "$subtitle" "$body"
      notify_dialog "$title" "$msg" "$path"
      ;;
    *)
      # default: dialog (reliable)
      notify_dialog "$title" "$msg" "$path"
      ;;
  esac
}

{
  echo "==== $(date '+%Y-%m-%d %H:%M:%S') ===="
  echo "args: $*"
  echo "root=$ROOT"
  echo "node=$(command -v node 2>/dev/null || echo MISSING)"
  echo "XHS_CAPTURE_ROOT=${XHS_CAPTURE_ROOT:-}"
  echo "NOTIFY_MODE=$NOTIFY_MODE"
} >"$LOG"

if [[ ! -x "$CAPTURE" ]]; then
  msg="找不到脚本: $CAPTURE"
  echo "$msg" | tee -a "$LOG" >&2
  notify_user "xhs-capture 失败" "脚本缺失" "$msg" ""
  exit 2
fi

set +e
out="$("$CAPTURE" "$@" 2>"$ERR")"
code=$?
set -e

{
  echo "exit=$code"
  echo "--- stderr ---"
  cat "$ERR" 2>/dev/null || true
  echo "--- stdout ---"
  printf '%s\n' "$out"
} >>"$LOG"

ntitle="xhs-capture"
nsub=""
nbody="详见日志 $LOG"
npath=""

if command -v node >/dev/null 2>&1 && [[ -n "${out:-}" ]]; then
  parsed="$(
    printf '%s' "$out" | node -e '
let d="";
process.stdin.on("data", c => d += c);
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(d);
    const t = String(j.title || "笔记").slice(0, 40);
    const q = String(j.quality || "");
    const p = String(j.path || "");
    const m = Array.isArray(j.missing) ? j.missing.join(",") : "";
    process.stdout.write([t, q, p, m].join("\t"));
  } catch {
    process.stdout.write("\t\t\t");
  }
});
'
  )"
  IFS=$'\t' read -r jtitle jquality jpath jmissing <<<"$parsed"
else
  jtitle="" jquality="" jpath="" jmissing=""
fi

case "$code" in
  0)
    ntitle="xhs-capture 已保存"
    nsub="${jtitle:-笔记}  ·  ${jquality:-full}"
    nbody="${jpath:-已写入默认目录}"
    npath="${jpath:-}"
    ;;
  3)
    ntitle="xhs-capture 已保存（降级）"
    nsub="${jtitle:-笔记}"
    nbody="${jmissing:+缺: $jmissing
}${jpath:-已降级保存}"
    npath="${jpath:-}"
    ;;
  2)
    ntitle="xhs-capture 环境失败"
    nsub="请检查 Chrome / Node / 权限"
    nbody="$(tail -n 3 "$ERR" 2>/dev/null | tr '\n' ' ' | cut -c1-160)"
    [[ -z "$nbody" ]] && nbody="运行 xhs-capture-doctor 查看环境"
    npath=""
    ;;
  1)
    ntitle="xhs-capture 未保存"
    nsub="业务失败"
    nbody="$(tail -n 3 "$ERR" 2>/dev/null | tr '\n' ' ' | cut -c1-160)"
    [[ -z "$nbody" ]] && nbody="请先在 Chrome 打开小红书笔记详情页"
    npath=""
    ;;
  *)
    ntitle="xhs-capture 失败"
    nsub="exit $code"
    nbody="$(tail -n 3 "$ERR" 2>/dev/null | tr '\n' ' ' | cut -c1-160)"
    [[ -z "$nbody" ]] && nbody="见 $LOG"
    npath=""
    ;;
esac

notify_user "$ntitle" "$nsub" "$nbody" "$npath"
exit "$code"
