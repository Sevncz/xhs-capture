# xhs-capture

把 **Chrome 里已经打开的小红书笔记详情页** 保存到本机文件夹（macOS）。

仅供个人学习与个人效率使用，见 [LICENSE](./LICENSE)。无担保。

## 做什么

1. 你在 Chrome 里正常打开一篇笔记详情  
2. 运行 `./run`（或快捷指令调用 `shortcut.sh`）  
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

## 安装（代码）

```bash
git clone https://github.com/Sevncz/xhs-capture.git
cd xhs-capture
./doctor
```

`doctor` **只检查环境、打印绝对路径**，不安装任何软件。

## 日常用法

先在 Chrome 打开笔记详情，再执行：

```bash
./run
./run --deep              # 额外 raw.html + curl 下图
./run --comments          # 抓评论（默认关闭，需显式打开）
./run --list
./run --list --limit 50
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
./run
# 或
./run --out /path/to/dir
```

---

## 快捷指令（推荐日常触发）

### 有没有「快速安装」？

| 方式 | 速度 | 说明 |
|------|------|------|
| **手建一条「运行 Shell 脚本」** | 约 1 分钟 | 最稳；路径随本机 clone 位置变化，必须贴**你机器上的绝对路径** |
| **iCloud 分享链接** | 点一下导入 | Apple 官方「快速安装」形态；但链接里的 Shell 路径是分享者本机的，**别人导入后仍要改成自己的 `shortcut.sh` 路径** |
| **仓库一键装快捷指令** | ❌ 没有 | 系统 `shortcuts` 命令只能 run / list / sign，**不能**从 CLI 新建快捷指令；也无法可靠生成通用 `.shortcut` 包给所有人用 |

结论：代码用 git 装；快捷指令**建议每人手建一次**（或导入模板后再改路径）。`./doctor` 会打印可直接粘贴的绝对路径。

### 手建步骤（约 1 分钟）

1. 在本仓库目录执行：

   ```bash
   ./doctor
   ```

   末尾会类似输出：

   ```text
   → Shortcuts: paste this absolute path into Run Shell Script:
     /Users/你的用户名/.../xhs-capture/shortcut.sh
   ```

2. 打开 macOS **快捷指令** App → 点 **+** 新建。  
3. 搜索并添加动作：**运行 Shell 脚本**（Run Shell Script）。  
4. 设置：  
   - Shell：`/bin/bash` 或 `/bin/zsh` 均可  
   - 输入：一般选「作为参数」或关掉输入（本脚本不读 stdin）  
   - **脚本内容只贴一行**（换成 doctor 打印的路径）：

   ```bash
   /Users/你的用户名/.../xhs-capture/shortcut.sh
   ```

   深度保存则：

   ```bash
   /Users/你的用户名/.../xhs-capture/shortcut.sh --deep
   ```

5. 命名（例如 `保存小红书笔记`）→ 完成。  
6. 可选：  
   - 点快捷指令详情 → **添加到菜单栏 / 固定到程序坞**  
   - **使用时显示**可关，减少弹窗  
   - 设置 **键盘快捷键**（系统设置 → 键盘 → 键盘快捷键 → 服务 / 快捷指令，视系统版本而定）

7. **第一次运行**时，系统会要自动化权限：允许「快捷指令」控制 **Google Chrome**、可能还要允许访问磁盘。请点允许。  
8. Chrome 需已勾选：**查看 → 开发者 → 允许 Apple 事件中的 JavaScript**。

### 使用方式

1. Chrome 打开一篇笔记详情（前台可见即可）  
2. 跑你建好的快捷指令（菜单栏 / 快捷键 / 快捷指令 App）  
3. 右上角通知：成功会显示标题与路径；失败看日志

日志：

```text
/tmp/xhs-capture-shortcut.log
/tmp/xhs-capture-shortcut.log.err
```

### 仓库搬家 / 重装后

路径变了会失败。再跑一次 `./doctor`，把快捷指令里那一行 Shell 路径改成新的绝对路径即可。

### 用 iCloud 链接分享（可选，给熟人）

若你**自己**已经建好一条快捷指令，可在快捷指令 App 里：**分享 → 拷贝 iCloud 链接**。  
对方打开链接会导入模板，但 **Shell 脚本里的路径仍是你的路径**，对方必须改成自己 clone 后的 `shortcut.sh` 绝对路径。  
因此公开仓库**不绑定**某个 iCloud 链接（避免路径写死误导）。

### 替代：Raycast / 终端别名

不折腾快捷指令时：

```bash
# 在 shell 配置里
alias xhs-save='/Users/你的用户名/.../xhs-capture/run'
```

或在 Raycast 里加 Script Command，内容同样指向 `run` / `shortcut.sh`。

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
| `node: not found` | 安装 Node ≥ 18；用 `./run` 或 `shortcut.sh`（勿在 GUI 里裸调 node） |
| exit 1 | 先打开笔记详情（URL 含 `/explore/` 等） |
| 截图不对 | 截的是窗口；笔记需在该窗口可见 |
| 快捷指令没反应 | 看 `/tmp/xhs-capture-shortcut.log`；路径是否仍指向本机 `shortcut.sh` |

## 给 AI 编程助手

- 先 `./doctor`，再 `./run` / `./run --list`  
- **不要**加浏览器自动化栈，不要替用户导航标签  
- 默认落盘 `./captures`，除非设置了 `XHS_CAPTURE_ROOT`

## 许可

仅个人学习使用；禁止商用与再分发（除非获得书面许可）。详见 [LICENSE](./LICENSE)。
