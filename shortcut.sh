#!/usr/bin/env bash
# macOS Shortcuts / Raycast: capture + system notification
#
# After ./install.sh, Shortcuts can use a portable line:
#   "$HOME/.local/bin/xhs-capture-shortcut"
# Deep:
#   "$HOME/.local/bin/xhs-capture-shortcut" --deep
#
# Logs: /tmp/xhs-capture-shortcut.log

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

notify() {
  local t s b
  t=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  s=$(printf '%s' "$2" | sed 's/\\/\\\\/g; s/"/\\"/g')
  b=$(printf '%s' "$3" | sed 's/\\/\\\\/g; s/"/\\"/g')
  /usr/bin/osascript -e "display notification \"$b\" with title \"$t\" subtitle \"$s\"" 2>/dev/null || true
}

{
  echo "==== $(date '+%Y-%m-%d %H:%M:%S') ===="
  echo "args: $*"
  echo "root=$ROOT"
  echo "node=$(command -v node 2>/dev/null || echo MISSING)"
  echo "XHS_CAPTURE_ROOT=${XHS_CAPTURE_ROOT:-}"
} >"$LOG"

if [[ ! -x "$CAPTURE" ]]; then
  msg="missing: $CAPTURE"
  echo "$msg" | tee -a "$LOG" >&2
  notify "xhs-capture" "script missing" "$msg"
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
nsub="exit $code"
nbody="see $LOG"

if command -v node >/dev/null 2>&1 && [[ -n "${out:-}" ]]; then
  parsed="$(
    printf '%s' "$out" | node -e '
let d="";
process.stdin.on("data", c => d += c);
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(d);
    const t = String(j.title || "note").slice(0, 36);
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
    ntitle="${jtitle:-saved}"
    nsub="✓ ${jquality:-full}"
    nbody="${jpath:-ok}"
    ;;
  3)
    ntitle="${jtitle:-saved}"
    nsub="⚠ degraded"
    nbody="${jmissing:+missing: $jmissing | }${jpath:-degraded}"
    ;;
  2)
    ntitle="xhs-capture"
    nsub="env failed"
    nbody="$(tail -n 2 "$ERR" 2>/dev/null | tr '\n' ' ' | cut -c1-100)"
    [[ -z "$nbody" ]] && nbody="run ./doctor — Chrome / Node / permissions"
    ;;
  1)
    ntitle="xhs-capture"
    nsub="failed"
    nbody="$(tail -n 2 "$ERR" 2>/dev/null | tr '\n' ' ' | cut -c1-100)"
    [[ -z "$nbody" ]] && nbody="open a note detail page in Chrome first"
    ;;
  *)
    ntitle="xhs-capture"
    nsub="exit $code"
    nbody="$(tail -n 3 "$ERR" 2>/dev/null | tr '\n' ' ' | cut -c1-100)"
    [[ -z "$nbody" ]] && nbody="see $LOG"
    ;;
esac

notify "$ntitle" "$nsub" "$nbody"
exit "$code"
