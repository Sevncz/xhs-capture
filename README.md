# xhs-capture

把 **Chrome 里已经打开的小红书笔记详情页** 保存到本机文件夹（macOS）。

仅供个人学习与个人效率使用，见 [LICENSE](./LICENSE)。无担保。

## 做什么

1. 你在 Chrome 里正常打开一篇笔记详情  
2. 运行 `xhs-capture` / `./run`（或快捷指令调用固定入口）  
3. 工具对**当前已有标签**做只读抽取（Apple Events + JavaScript）  
4. 写入 `./captures/`（可用环境变量改路径）

**不会**新建浏览器窗口、不会替你跳转页面、不依赖第三方浏览器 CLI。

## 环境要求

| 需要 | 说明 |
|------|------|
| macOS | 使用 `osascript`、`screencapture` |
| Google Chrome | 笔记详情标签需已打开 |
| Node.js ≥ 18 | 唯一运行时依赖 |
| Chrome 开关 | **查看 → 开发者 → 允许 Apple 事件中的 JavaScript** |
| 系统权限 | 隐私与安全性 → 自动化：允许「终端 / 快捷指令」控制 Google Chrome |

## 安装

```bash
git clone https://github.com/Sevncz/xhs-capture.git
cd xhs-capture
./install.sh    # 把命令链到 ~/.local/bin（固定路径，给快捷指令用）
./doctor        # 检查环境
```

### `install.sh` 做什么

| 入口 | 作用 |
|------|------|
| `~/.local/bin/xhs-capture` | 终端 CLI（= `run`） |
| `~/.local/bin/xhs-capture-shortcut` | 快捷指令 / 通知（= `shortcut.sh`） |
| `~/.local/bin/xhs-capture-doctor` | 环境检查 |

默认是 **symlink 到本仓库**（`git pull` 后不用重装；若你挪了 clone 目录，再跑一次 `./install.sh`）。

```bash
./install.sh --copy       # 复制到 ~/.local/share/xhs-capture，clone 可删
./install.sh --uninstall  # 只删 bin 入口
```

**不安** Node / Chrome；只装本工具的入口。

若提示 `~/.local/bin` 不在 PATH，把下面写入 `~/.zshrc`（仅终端需要；快捷指令用 `$HOME/...` 完整路径即可）：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

---

## 快捷指令（推荐）

### 推荐流程（路径固定，导入后不用改）

1. 本机执行 `./install.sh`（见上）  
2. 导入快捷指令（二选一）：  
   - **iCloud**：[保存 xhs 笔记](https://www.icloud.com/shortcuts/de79d50eed5a47e0adc7c69ba1280ca3)  
   - **仓库内文件**：双击 / 用「快捷指令」打开本仓的 `保存xhs笔记.shortcut`  
3. 确认「运行 Shell 脚本」内容为（**推荐写法，所有用户通用**）：

   ```bash
   "$HOME/.local/bin/xhs-capture-shortcut"
   ```

   深度保存：

   ```bash
   "$HOME/.local/bin/xhs-capture-shortcut" --deep
   ```

4. 首次运行时允许「快捷指令」控制 Google Chrome。  
5. Chrome 勾选：**查看 → 开发者 → 允许 Apple 事件中的 JavaScript**。

只要对方先 `install.sh`，快捷指令里写 `$HOME/.local/bin/...`，**不必再改成各自的 clone 路径**。

> 若你分享的旧版快捷指令仍写着 `/Users/某用户/.../shortcut.sh`，请编辑成上面的 `$HOME/.local/bin/xhs-capture-shortcut`，再重新「分享 → 拷贝 iCloud 链接」。

### 为什么需要 install？

| 问题 | 做法 |
|------|------|
| clone 路径每人不同 | 入口统一装到 `~/.local/bin` |
| 系统不能「一条命令创建快捷指令」 | 用 iCloud 模板 + 固定 Shell 行 |
| GUI 里 PATH 很短 | `shortcut.sh` 会自己补 PATH；且用 `$HOME/...` 绝对路径 |

### 手建（不用 iCloud 时）

快捷指令 App → 新建 → **运行 Shell 脚本** → 贴：

```bash
"$HOME/.local/bin/xhs-capture-shortcut"
```

### 日志

```text
/tmp/xhs-capture-shortcut.log
/tmp/xhs-capture-shortcut.log.err
```

---

## 日常用法

先在 Chrome 打开笔记详情，再执行：

```bash
xhs-capture                 # 或 ./run
xhs-capture --deep
xhs-capture --comments      # 抓评论（默认关闭）
xhs-capture --list
```

### 落盘结构

```text
captures/YYYY-MM-DD-标题/
  meta.json
  content.md
  shot.png
  # --comments 时:
  comments.json
  comments.md
  # --deep 时:
  raw.html
  images/
```

同一 `note_id` 会覆盖旧目录（保留 `first_captured_at`）。

### 改保存位置

```bash
export XHS_CAPTURE_ROOT="$HOME/my-notes"
xhs-capture
# 或
xhs-capture --out /path/to/dir
```

---

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 完整保存 |
| 3 | 已保存但降级（缺作者/互动数等） |
| 2 | 环境问题（Node、Chrome 自动化、权限） |
| 1 | 业务失败（没有笔记页、抽不到内容） |

## 故障排查

| 现象 | 检查 |
|------|------|
| 抽不到正文 / Apple JS 报错 | Chrome → 允许 Apple 事件中的 JavaScript |
| 读不到标签 | 系统设置 → 隐私与安全性 → 自动化 → 允许控制 Google Chrome |
| `node: not found` | 安装 Node ≥ 18；用 `xhs-capture` / `xhs-capture-shortcut` |
| exit 1 | 先打开笔记详情（URL 含 `/explore/` 等） |
| 快捷指令失败 | 是否已 `./install.sh`；Shell 是否为 `"$HOME/.local/bin/xhs-capture-shortcut"`；看 `/tmp/xhs-capture-shortcut.log` |
| 挪了仓库目录 | 再跑一次 `./install.sh`（symlink 模式） |

## 给 AI 编程助手

**硬规则：抓取前必须先设定下载路径。**

```bash
# 用户指定了目录 → 用用户的；否则先问，或按项目约定设默认
export XHS_CAPTURE_ROOT="/绝对路径/到落盘根"
# 然后再
./run
# 或
xhs-capture
```

| 要求 | 说明 |
|------|------|
| 先路径、后抓取 | 未设 `XHS_CAPTURE_ROOT` 时默认写入仓库内 `./captures/`，常不是用户想要的位置 |
| 回复里写 path | 把 stdout JSON 的 `path` 告诉用户，确认落盘正确 |
| list 用同一路径 | `--list` 也要带同一个 `XHS_CAPTURE_ROOT` |
| 禁止 | 代开页、导航、browser bind、装 opencli 做采集 |

可选：`./install.sh`、`./doctor`。  
writer harness 内默认约定见该仓 skill `xhs-capture`（`assets/xhs-captures`）。

## 许可

仅个人学习使用；禁止商用与再分发（除非获得书面许可）。详见 [LICENSE](./LICENSE)。
