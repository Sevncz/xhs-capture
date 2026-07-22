# xhs-capture

Save a **Xiaohongshu note detail page already open in Google Chrome** to local files on your Mac.

Personal use / learning only. See [LICENSE](./LICENSE). No warranty.

## What it does

1. You open a note detail page in Chrome (normal browsing).
2. You run `./run` (or a Shortcuts entry that calls `shortcut.sh`).
3. The tool reads the **existing tab** via Apple Events (read-only JavaScript).
4. It writes a folder under `./captures/` (or `XHS_CAPTURE_ROOT`).

It does **not** open new browser windows, navigate for you, or call third-party browser CLIs.

## Requirements

| Need | Notes |
|------|--------|
| macOS | Uses `osascript` + `screencapture` |
| Google Chrome | Note tab must already be open |
| Node.js ≥ 18 | Only runtime dependency |
| Chrome setting | **View → Developer → Allow JavaScript from Apple Events** |
| Automation | Allow Terminal / Shortcuts to control Google Chrome |

## Setup

```bash
git clone https://github.com/Sevncz/xhs-capture.git
cd xhs-capture
./doctor
```

`doctor` only **checks** your environment. It does not install software.

## Usage

```bash
# Open a note detail page in Chrome first, then:
./run
./run --deep              # also raw.html + download image URLs via curl
./run --no-comments
./run --list
./run --list --limit 50
```

### Output layout

```text
captures/YYYY-MM-DD-title/
  meta.json
  content.md
  comments.json
  comments.md
  shot.png
  # with --deep:
  raw.html
  images/
```

Same `note_id` overwrites the previous folder (keeps `first_captured_at`).

### Override save location

```bash
export XHS_CAPTURE_ROOT="$HOME/my-notes"
./run
# or
./run --out /path/to/dir
```

### macOS Shortcuts

1. Run `./doctor` and copy the printed absolute path to `shortcut.sh`.
2. Create a Shortcut → **Run Shell Script** → paste that path.
3. Optional: append `--deep`.

Logs: `/tmp/xhs-capture-shortcut.log`

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Full quality save |
| 3 | Saved but degraded (missing author/stats/etc.) |
| 2 | Environment (Node, Chrome automation, permissions) |
| 1 | Business failure (no note tab, empty extract) |

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Cannot read body / Apple JS error | Chrome → Allow JavaScript from Apple Events |
| Cannot list tabs | Privacy → Automation → control Google Chrome |
| `node: not found` | Install Node ≥ 18; use `./run` (not bare `node` from GUI) |
| Exit 1, not a note page | Open a detail URL (`/explore/...` etc.) |
| Wrong screenshot | Window capture only; keep the note visible in that window |

## For AI coding agents

- Run `./doctor`, then `./run` / `./run --list`.
- Do **not** add browser automation stacks or navigate the user’s tabs.
- Default output is `./captures` unless `XHS_CAPTURE_ROOT` is set.

## License

Personal learning use only. No commercial use or redistribution without permission. See [LICENSE](./LICENSE).
