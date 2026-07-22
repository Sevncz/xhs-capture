#!/usr/bin/env node
/**
 * xhs-capture — save a Xiaohongshu note page already open in Chrome to local files.
 *
 * - Read-only Apple Events JS on the existing note tab (no navigation, no new window)
 * - Default output: ./captures/YYYY-MM-DD-title/  (override with XHS_CAPTURE_ROOT or --out)
 * - Same note_id overwrites; keeps first_captured_at
 *
 * Exit: 0 full | 3 degraded | 2 env | 1 business failure
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  cpSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_ROOT = join(__dirname, "captures");

const EXIT = {
  OK: 0,
  FAIL: 1,
  ENV: 2,
  DEGRADED: 3,
};

// ── CLI ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    deep: false,
    list: false,
    limit: 20,
    // Temporarily off: re-enable default with comments: true when needed
    comments: false,
    commentsLimit: 40,
    withReplies: true,
    outRoot: process.env.XHS_CAPTURE_ROOT || DEFAULT_OUT_ROOT,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--deep") args.deep = true;
    else if (a === "--list") args.list = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--no-comments") args.comments = false;
    else if (a === "--comments") args.comments = true;
    else if (a === "--with-replies") args.withReplies = true;
    else if (a === "--no-replies") args.withReplies = false;
    else if (a === "--comments-limit") {
      args.commentsLimit = Math.max(1, Math.min(100, Number(argv[++i] || 40)));
    } else if (a === "--limit") args.limit = Number(argv[++i] || 20);
    else if (a === "--out") args.outRoot = resolve(argv[++i] || DEFAULT_OUT_ROOT);
    else if (a.startsWith("-")) {
      fail(`未知参数: ${a}`, EXIT.FAIL);
    }
  }
  return args;
}

function usage() {
  return `用法:
  ./run                 标准包（正文 + 截图；默认不抓评论）
  ./run --deep          深度包（+ raw.html + 下图）
  ./run --comments      额外抓评论（暂时默认关闭）
  ./run --comments-limit 60
  ./run --no-replies    只要一级评论（需同时 --comments）
  ./run --list
  ./shortcut.sh         快捷指令入口

落盘（默认 ./captures，可用 XHS_CAPTURE_ROOT 或 --out 覆盖）:
  captures/YYYY-MM-DD-标题/
    meta.json  content.md  shot.png
    comments.json  comments.md   # 仅 --comments 时

说明: 在已打开的笔记标签上只读抽取（Apple Events），不导航、不新建窗口
Chrome: 查看 → 开发者 → 允许 Apple 事件中的 JavaScript
退出码: 0 完整 | 3 降级 | 2 环境 | 1 业务失败
`;
}

function sleep(ms) {
  spawnSync("sleep", [String(ms / 1000)], { timeout: ms + 2000 });
}

/** 文件夹名用标题；去掉路径非法字符 */
function titleFolderName(title, noteId) {
  let s = String(title || "")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // 去掉首尾点（macOS 隐藏/怪异）
  s = s.replace(/^\.+|\.+$/g, "").trim();
  if (s.length > 80) s = s.slice(0, 80).trim();
  if (!s) s = noteId || "untitled";
  return s;
}

/** 扫描 capture 根：兼容 新=YYYY-MM-DD-标题 与 旧=YYYY-MM-DD/note_id */
function walkCaptureDirs(outRoot) {
  if (!existsSync(outRoot)) return [];
  const found = [];
  for (const name of readdirSync(outRoot)) {
    if (name.startsWith(".")) continue;
    const p = join(outRoot, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const metaDirect = join(p, "meta.json");
    if (existsSync(metaDirect)) {
      found.push(p);
      continue;
    }
    // legacy nested
    try {
      for (const child of readdirSync(p)) {
        const cp = join(p, child);
        if (existsSync(join(cp, "meta.json")) && statSync(cp).isDirectory()) {
          found.push(cp);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return found;
}

function readMeta(dir) {
  const metaPath = join(dir, "meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

function findDirByNoteId(outRoot, noteId) {
  if (!noteId) return null;
  for (const dir of walkCaptureDirs(outRoot)) {
    const m = readMeta(dir);
    if (m?.note_id === noteId) return dir;
  }
  return null;
}

function resolveCaptureDir(outRoot, note) {
  const noteId = note.noteId || "unknown";
  const day = todayStamp();
  const folderTitle = titleFolderName(note.title, noteId);
  let desiredName = `${day}-${folderTitle}`;
  let desired = join(outRoot, desiredName);

  const existing = findDirByNoteId(outRoot, noteId);
  if (existing) {
    // 同 note：覆盖；若标题变了则改名到 desired
    if (existing === desired) return existing;
    // desired 被别的笔记占了？
    if (existsSync(desired)) {
      const other = readMeta(desired);
      if (other?.note_id && other.note_id !== noteId) {
        desiredName = `${day}-${folderTitle}-${noteId.slice(0, 8)}`;
        desired = join(outRoot, desiredName);
      }
    }
    if (existing !== desired) {
      try {
        if (existsSync(desired)) {
          // 极端：目标已存在且是自己（不应发生）— 清目标后 rename
          const om = readMeta(desired);
          if (om?.note_id === noteId) {
            rmSync(existing, { recursive: true, force: true });
            return desired;
          }
        }
        mkdirSync(outRoot, { recursive: true });
        renameSync(existing, desired);
        return desired;
      } catch (e) {
        console.error(`  (改名到标题目录失败，沿用旧目录: ${e.message})`);
        return existing;
      }
    }
    return existing;
  }

  // 新笔记：标题冲突则加 note_id 后缀
  if (existsSync(desired)) {
    const other = readMeta(desired);
    if (other?.note_id && other.note_id !== noteId) {
      desiredName = `${day}-${folderTitle}-${noteId.slice(0, 8)}`;
      desired = join(outRoot, desiredName);
    }
  }
  mkdirSync(desired, { recursive: true });
  return desired;
}

// ── note id / url ────────────────────────────────────────────────

const NOTE_PATH_RE =
  /\/(?:explore|note|search_result|discovery\/item)\/([a-f0-9]+)|\/user\/profile\/[^/?#]+\/([a-f0-9]+)/i;

function parseNoteId(urlOrPath) {
  const m = String(urlOrPath).match(NOTE_PATH_RE);
  return m ? m[1] || m[2] : null;
}

function isNoteDetailUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (
      !(
        host === "xiaohongshu.com" ||
        host.endsWith(".xiaohongshu.com") ||
        host === "rednote.com" ||
        host.endsWith(".rednote.com")
      )
    ) {
      return false;
    }
    return NOTE_PATH_RE.test(u.pathname);
  } catch {
    return false;
  }
}

function todayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoNow() {
  return new Date().toISOString();
}

function numOrZero(v) {
  if (v == null || v === "") return null;
  const s = String(v).replace(/,/g, "").trim();
  if (/^\d+(\.\d+)?[万wW]?$/.test(s) || /^\d+/.test(s)) return s;
  // XHS placeholder: 赞/收藏/评论
  if (/^(赞|收藏|评论|分享)$/.test(s)) return "0";
  return s;
}

// ── page extract IIFE ────────────────────────────────────────────
// 在页面内只读：__INITIAL_STATE__ 优先，DOM 兜底。不发任何网络请求。

const EXTRACT_JS = `(() => {
  const bodyText = document.body?.innerText || '';
  const pageUrl = location.href;
  const pathMatch = (location.pathname || '').match(
    /\\/(?:explore|note|search_result|discovery\\/item)\\/([a-f0-9]+)|\\/user\\/profile\\/[^/?#]+\\/([a-f0-9]+)/i
  );
  const noteId = pathMatch ? (pathMatch[1] || pathMatch[2]) : null;

  const flags = {
    loginWall: /登录后查看|请登录/.test(bodyText),
    notFound: /页面不见了|笔记不存在|无法浏览/.test(bodyText),
    securityBlock: /安全限制|访问链接异常/.test(bodyText)
      || /website-login\\/error|error_code=300017|error_code=300031/.test(pageUrl),
  };

  const clean = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  const sources = [];

  let title = '';
  let desc = '';
  let author = '';
  let authorId = '';
  let likes = null;
  let collects = null;
  let comments = null;
  let shares = null;
  let tags = [];
  let images = [];
  let ipLocation = '';
  let publishTime = '';

  const normalizeImageUrl = (raw) => {
    if (!raw || typeof raw !== 'string') return '';
    let src = raw.split('?')[0];
    src = src.replace(/\\/imageView\\d+\\/\\d+\\/w\\/\\d+/, '');
    return src;
  };

  const pushImage = (url) => {
    const src = normalizeImageUrl(url);
    if (!src) return;
    if (!(src.includes('xhscdn') || src.includes('xiaohongshu') || src.includes('rednote') || src.includes('sns-img'))) return;
    if (!images.includes(src)) images.push(src);
  };

  const firstLine = (text) => {
    const lines = String(text || '').split(/\\n+/).map(s => s.trim()).filter(Boolean);
    return lines[0] || '';
  };
  const stripSiteSuffix = (s) => String(s || '')
    .replace(/\\s*[-|–—]\\s*小红书.*$/u, '')
    .replace(/\\s*[-|–—]\\s*xiaohongshu.*$/i, '')
    .replace(/\\s*[-|–—]\\s*RED.*$/i, '')
    .trim();

  // Resolve note object from hydration map (prefer URL noteId)
  const pickNoteFromMap = (map, id) => {
    if (!map || typeof map !== 'object') return null;
    if (id && map[id]) {
      const entry = map[id];
      return entry?.note || entry || null;
    }
    const values = Object.values(map);
    for (const entry of values) {
      const n = entry?.note || entry;
      if (!n || typeof n !== 'object') continue;
      const nid = n.noteId || n.id || n.note_id;
      if (id && nid && String(nid) === String(id)) return n;
    }
    if (values.length === 1) {
      const entry = values[0];
      return entry?.note || entry || null;
    }
    return null;
  };

  // --- __INITIAL_STATE__ (hydration payload already in page) ---
  try {
    const state = window.__INITIAL_STATE__;
    const noteStore = state?.note || {};
    const map = noteStore.noteDetailMap || noteStore.note || {};
    let note = pickNoteFromMap(map, noteId);
    if (!note && noteStore.firstNoteId) {
      note = pickNoteFromMap(map, noteStore.firstNoteId);
    }
    if (note && typeof note === 'object') {
      sources.push('initial_state');
      title = note.title || note.displayTitle || title;
      desc = note.desc || note.description || note.nniche || desc;
      const user = note.user || note.author || {};
      author = user.nickname || user.nickName || user.name || author;
      authorId = user.userId || user.id || authorId;
      const ie = note.interactInfo || note.interact || {};
      likes = ie.likedCount ?? ie.likeCount ?? likes;
      collects = ie.collectedCount ?? ie.collectCount ?? collects;
      comments = ie.commentCount ?? comments;
      shares = ie.shareCount ?? shares;
      ipLocation = note.ipLocation || note.ip_location || ipLocation;
      publishTime = note.time || note.createTime || note.timestamp || publishTime;
      if (Array.isArray(note.tagList)) {
        tags = note.tagList.map(t => t?.name || t?.tagName || t).filter(Boolean);
      } else if (Array.isArray(note.hashTag)) {
        tags = note.hashTag.map(t => t?.name || t).filter(Boolean);
      }
      if (Array.isArray(note.imageList)) {
        for (const item of note.imageList) {
          const candidate = item?.urlDefault || item?.urlPre || item?.url
            || item?.infoList?.find(i => i?.imageScene === 'WB_DFT')?.url
            || item?.infoList?.[0]?.url
            || '';
          pushImage(candidate);
        }
      }
    }
  } catch (e) {}

  // --- DOM fallback (scoped to note container — never bare .title) ---
  const noteRoot =
    document.querySelector('#noteContainer')
    || document.querySelector('.note-container')
    || document.querySelector('.note-detail')
    || document.querySelector('[class*="note-detail"]')
    || document.querySelector('main')
    || document;

  const q = (sel) => noteRoot.querySelector(sel);
  const qClean = (sel) => clean(q(sel));

  // Prefer explicit detail title nodes; never use document-wide ".title"
  // (related-feed / sidebar cards also use .title and pollute folder names)
  let domTitle = qClean('#detail-title')
    || qClean('.note-content .title')
    || qClean('[id="detail-title"]');
  if (!domTitle) {
    const scoped = q('.note-content') || q('#detail-desc') || null;
    if (scoped) {
      const tEl = scoped.querySelector('#detail-title, .title');
      if (tEl) domTitle = clean(tEl);
    }
  }

  const domDesc = qClean('#detail-desc')
    || qClean('.note-content .desc')
    || qClean('.note-text')
    || qClean('#detail-desc .note-text')
    || qClean('.desc');

  const domAuthor = qClean('.author-wrapper .username')
    || qClean('.author-wrapper .name')
    || qClean('.username')
    || qClean('.author-name')
    || clean(document.querySelector('.author-wrapper .username, .author-wrapper .name'));

  const interact = document.querySelector('.interact-container') || noteRoot;
  const domLikes = clean(interact.querySelector('.like-wrapper .count, .like-wrapper'));
  const domCollects = clean(interact.querySelector('.collect-wrapper .count, .collect-wrapper'));
  const domComments = clean(interact.querySelector('.chat-wrapper .count, .chat-wrapper'));

  // meta / document.title — better than random sidebar .title
  const ogTitle = stripSiteSuffix(
    document.querySelector('meta[property="og:title"]')?.content
    || document.querySelector('meta[name="og:title"]')?.content
    || ''
  );
  const docTitle = stripSiteSuffix(document.title || '');

  if (!title && domTitle) { title = domTitle; if (!sources.includes('dom')) sources.push('dom'); }
  if (!title && ogTitle) { title = ogTitle; if (!sources.includes('meta')) sources.push('meta'); }
  if (!title && docTitle && !/小红书|xiaohongshu|rednote/i.test(docTitle)) {
    title = docTitle;
    if (!sources.includes('document_title')) sources.push('document_title');
  }

  if (!desc && domDesc) { desc = domDesc; if (!sources.includes('dom')) sources.push('dom'); }
  if (!author && domAuthor) { author = domAuthor; if (!sources.includes('dom')) sources.push('dom'); }
  if (likes == null && domLikes) { likes = domLikes; if (!sources.includes('dom')) sources.push('dom'); }
  if (collects == null && domCollects) { collects = domCollects; if (!sources.includes('dom')) sources.push('dom'); }
  if (comments == null && domComments) { comments = domComments; if (!sources.includes('dom')) sources.push('dom'); }

  // No formal title: many notes put the headline in the first line of body
  if (!title && desc) {
    const fl = firstLine(desc);
    // skip pure hashtag lines
    if (fl && !/^#/.test(fl)) {
      title = fl.length > 80 ? fl.slice(0, 80) : fl;
      if (!sources.includes('desc_first_line')) sources.push('desc_first_line');
    }
  }

  // Sanity: bare .title often grabs related-feed cards. If title is not part of
  // desc / og / doc title, and we have a better candidate, prefer that.
  if (title && desc && !sources.includes('initial_state')) {
    const fl = firstLine(desc);
    const inDesc = desc.includes(title);
    const matchesOg = ogTitle && (ogTitle === title || ogTitle.includes(title) || title.includes(ogTitle));
    const matchesDoc = docTitle && (docTitle === title || docTitle.includes(title));
    if (!inDesc && !matchesOg && !matchesDoc && fl && fl !== title) {
      // keep short clickbait titles that equal first line only; otherwise replace
      title = fl.length > 80 ? fl.slice(0, 80) : fl;
      if (!sources.includes('title_repaired')) sources.push('title_repaired');
    }
  }

  if (!tags.length) {
    const tagRoot = q('#detail-desc') || noteRoot;
    tagRoot.querySelectorAll('a.tag, a[href*="search_result"], .tag-item').forEach(el => {
      const t = (el.textContent || '').trim();
      if (t) tags.push(t);
    });
    if (tags.length && !sources.includes('dom')) sources.push('dom');
  }

  if (!images.length) {
    const imageSelectors = [
      '.swiper-slide img',
      '.carousel-image img',
      '.note-slider img',
      '.note-image img',
      '.image-wrapper img',
      '#noteContainer .media-container img[src*="xhscdn"]',
      'img[src*="ci.xiaohongshu.com"]',
      'img[src*="sns-img"]',
    ];
    for (const selector of imageSelectors) {
      noteRoot.querySelectorAll(selector).forEach(img => {
        pushImage(img.src || img.getAttribute('data-src') || '');
      });
    }
    if (images.length && !sources.includes('dom')) sources.push('dom');
  }

  // 从 desc 里拆 hashtag 文本（无 a.tag 时）
  if (!tags.length && desc) {
    const m = desc.match(/#[^\\s#]+/g);
    if (m) tags = [...new Set(m.map(t => t.replace(/^#/, '')))];
  }

  return {
    pageUrl,
    noteId,
    flags,
    title: title || '',
    desc: desc || '',
    author: author || '',
    authorId: authorId || '',
    likes,
    collects,
    comments,
    shares,
    tags,
    images,
    ipLocation: ipLocation || '',
    publishTime: publishTime || '',
    sources,
  };
})()`;

function parseEvalOutput(stdout) {
  if (!stdout) return null;
  // Apple Events / JS eval: prefer JSON; else last object slice
  try {
    return JSON.parse(stdout);
  } catch {
    // try find last JSON object
    const i = stdout.indexOf("{");
    const j = stdout.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(stdout.slice(i, j + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ── write package ────────────────────────────────────────────────

function qualityOf(note) {
  const missing = [];
  if (!note.title) missing.push("title");
  if (!note.desc && !note.title) missing.push("content");
  if (!note.author) missing.push("author");
  if (note.likes == null) missing.push("likes");
  if (note.collects == null) missing.push("collects");
  if (note.comments == null) missing.push("comments");
  if (!note.images?.length) missing.push("images");

  const hasContent = Boolean((note.desc && note.desc.trim()) || (note.title && note.title.trim()));
  if (!hasContent) return { quality: "failed", missing };

  const criticalMissing = missing.filter((k) =>
    ["author", "likes", "collects", "comments"].includes(k),
  );
  if (criticalMissing.length === 0 && note.title) {
    return { quality: "full", missing };
  }
  return { quality: "degraded", missing };
}

function sourceLabel(sources) {
  const s = [...new Set(sources || [])];
  if (s.length === 0) return "unknown";
  if (s.length === 1) return s[0];
  return "mixed";
}

function writeCommentsFiles(dir, comments) {
  const list = Array.isArray(comments) ? comments : [];
  writeFileSync(
    join(dir, "comments.json"),
    JSON.stringify(
      {
        count: list.length,
        top_level: list.filter((c) => !c.is_reply).length,
        replies: list.filter((c) => c.is_reply).length,
        records: list,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const lines = [
    `# 评论（${list.length} 条）`,
    "",
    `一级 ${list.filter((c) => !c.is_reply).length} · 回复 ${list.filter((c) => c.is_reply).length}`,
    "",
  ];
  for (const c of list) {
    const prefix = c.is_reply ? "  ↳ " : "";
    const who = c.author || "匿名";
    const reply = c.is_reply && c.reply_to ? ` → ${c.reply_to}` : "";
    const meta = [c.likes != null ? `赞 ${c.likes}` : null, c.time || null]
      .filter(Boolean)
      .join(" · ");
    lines.push(`${prefix}**${who}**${reply}${meta ? ` （${meta}）` : ""}`);
    lines.push(`${prefix}${c.text}`);
    lines.push("");
  }
  if (!list.length) lines.push("_（未抓到评论，可能未滚动加载或选择器变更）_", "");
  writeFileSync(join(dir, "comments.md"), lines.join("\n"), "utf8");
}

function writePackage({ outRoot, note, deep, shotPath, network, rawHtml, comments }) {
  const noteId = note.noteId || "unknown";
  const dir = resolveCaptureDir(outRoot, note);

  let firstCapturedAt = isoNow();
  const metaPath = join(dir, "meta.json");
  if (existsSync(metaPath)) {
    try {
      const prev = JSON.parse(readFileSync(metaPath, "utf8"));
      if (prev.first_captured_at) firstCapturedAt = prev.first_captured_at;
    } catch {
      /* ignore */
    }
  }

  const { quality, missing } = qualityOf(note);
  const capturedAt = isoNow();
  const commentList = Array.isArray(comments) ? comments : null;

  const meta = {
    note_id: noteId,
    folder: basename(dir),
    url: note.pageUrl,
    title: note.title || "",
    author: note.author || "",
    author_id: note.authorId || "",
    stats: {
      likes: numOrZero(note.likes),
      collects: numOrZero(note.collects),
      comments: numOrZero(note.comments),
      shares: numOrZero(note.shares),
    },
    tags: note.tags || [],
    images: note.images || [],
    ip_location: note.ipLocation || "",
    publish_time: note.publishTime || "",
    comments_captured: commentList ? commentList.length : 0,
    comments_top_level: commentList
      ? commentList.filter((c) => !c.is_reply).length
      : 0,
    quality,
    missing,
    source: sourceLabel(note.sources),
    sources: note.sources || [],
    deep: Boolean(deep),
    captured_at: capturedAt,
    first_captured_at: firstCapturedAt,
  };

  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");

  const contentMd = [
    `# ${meta.title || "(无标题)"}`,
    "",
    `- 作者: ${meta.author || "—"}`,
    `- 链接: ${meta.url}`,
    `- note_id: ${meta.note_id}`,
    `- 赞/藏/评: ${meta.stats.likes ?? "—"} / ${meta.stats.collects ?? "—"} / ${meta.stats.comments ?? "—"}`,
    meta.tags?.length ? `- 标签: ${meta.tags.join(", ")}` : null,
    commentList
      ? `- 已抓评论: ${meta.comments_captured}（一级 ${meta.comments_top_level}）`
      : null,
    `- quality: ${meta.quality}`,
    `- captured_at: ${meta.captured_at}`,
    "",
    "## 正文",
    "",
    meta.title && note.desc && !note.desc.includes(meta.title) ? meta.title : null,
    note.desc || "_(无正文)_",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  writeFileSync(join(dir, "content.md"), contentMd, "utf8");

  if (commentList) {
    writeCommentsFiles(dir, commentList);
  }

  if (shotPath && existsSync(shotPath)) {
    const dest = join(dir, "shot.png");
    if (shotPath !== dest) {
      cpSync(shotPath, dest);
    }
  }

  if (deep) {
    if (rawHtml) {
      writeFileSync(join(dir, "raw.html"), rawHtml, "utf8");
    }
    if (network?.rawList || network?.detail) {
      writeFileSync(
        join(dir, "network.json"),
        JSON.stringify(
          {
            list_preview: safeJson(network.rawList),
            detail_key: network.key || null,
            detail: network.detail || null,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
    }
    // 尝试下载图片（可能失败；不拖垮主流程）
    if (meta.images?.length) {
      const imgDir = join(dir, "images");
      mkdirSync(imgDir, { recursive: true });
      let i = 0;
      for (const url of meta.images.slice(0, 30)) {
        i += 1;
        const idx = String(i).padStart(2, "0");
        const ext = guessExt(url);
        const dest = join(imgDir, `${idx}${ext}`);
        const ok = downloadFile(url, dest);
        if (!ok) {
          writeFileSync(join(imgDir, `${idx}.url.txt`), url + "\n", "utf8");
        }
      }
    }
  }

  return { dir, meta };
}

function safeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function guessExt(url) {
  const path = url.split("?")[0];
  const m = path.match(/\.(jpg|jpeg|png|webp|gif|heic)$/i);
  if (m) return `.${m[1].toLowerCase()}`;
  return ".jpg";
}

function downloadFile(url, dest) {
  // 用 curl，带常见 UA；失败返回 false
  const r = spawnSync(
    "curl",
    ["-fsSL", "-L", "--max-time", "30", "-A", "Mozilla/5.0", "-o", dest, url],
    { encoding: "utf8" },
  );
  return r.status === 0 && existsSync(dest) && statSync(dest).size > 0;
}

// ── list ─────────────────────────────────────────────────────────

function listCaptures(outRoot, limit) {
  if (!existsSync(outRoot)) {
    console.log(`(空) ${outRoot} 尚不存在`);
    return EXIT.OK;
  }
  const rows = [];
  for (const dir of walkCaptureDirs(outRoot)) {
    const m = readMeta(dir);
    const folder = basename(dir);
    if (!m) {
      rows.push({
        folder,
        note_id: "?",
        title: "?",
        quality: "corrupt",
        captured_at: "",
        path: dir,
      });
      continue;
    }
    rows.push({
      folder: m.folder || folder,
      note_id: m.note_id || "?",
      title: (m.title || folder).slice(0, 40),
      author: m.author || "",
      quality: m.quality || "?",
      captured_at: m.captured_at || "",
      path: dir,
    });
  }
  rows.sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
  const slice = rows.slice(0, limit);
  if (!slice.length) {
    console.log(`(空) ${outRoot}`);
    return EXIT.OK;
  }
  console.log(`共 ${rows.length} 条，显示 ${slice.length} 条:\n`);
  for (const r of slice) {
    console.log(
      `${r.captured_at || "—"}  [${r.quality}]  ${r.author || "—"}  |  ${r.title || "(无标题)"}`,
    );
    console.log(`  ${r.path}`);
  }
  return EXIT.OK;
}

// ── Chrome Apple Events 只读抽取（默认路径）────────────────────────
// 只对已打开的笔记 tab 执行 JS，不导航、不新建窗口。

// 分隔符用 | —— AppleScript 的 tab 常量在 & 拼接数字时会被收成字面量 "tab"
const CHROME_TABS_AS = `
tell application "Google Chrome"
  if not (it is running) then return "NOT_RUNNING"
  set winCount to count of windows
  if winCount is 0 then return "NO_WINDOWS"
  set out to ""
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set ti to 0
    try
      set activeIdx to active tab index of w
    on error
      set activeIdx to 1
    end try
    repeat with t in tabs of w
      set ti to ti + 1
      try
        set u to URL of t as text
        set flag to "0"
        if ti is activeIdx then set flag to "1"
        set out to out & (wi as text) & "|" & (ti as text) & "|" & flag & "|" & u & linefeed
      end try
    end repeat
  end repeat
  return out
end tell
`;

function listChromeTabs() {
  const r = spawnSync("osascript", ["-e", CHROME_TABS_AS], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (r.status !== 0) {
    return {
      ok: false,
      tabs: [],
      error: (r.stderr || r.stdout || "osascript failed").trim(),
    };
  }
  const raw = String(r.stdout || "").trim();
  if (raw === "NOT_RUNNING") {
    return { ok: false, tabs: [], error: "Google Chrome 未运行" };
  }
  if (raw === "NO_WINDOWS") {
    return { ok: false, tabs: [], error: "Chrome 没有打开的窗口" };
  }
  if (!raw) {
    return {
      ok: false,
      tabs: [],
      error:
        "读到空标签列表。若从快捷指令运行：系统设置 → 隐私与安全性 → 自动化 → 允许「快捷指令」控制 Google Chrome",
    };
  }
  const tabs = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // wi|ti|active|url  —— url 里可能含 |，只切前 3 次
    const m = line.match(/^(\d+)\|(\d+)\|([01])\|(.*)$/);
    if (!m) continue;
    tabs.push({
      windowIndex: Number(m[1]),
      tabIndex: Number(m[2]),
      active: m[3] === "1",
      url: m[4].trim(),
    });
  }
  if (!tabs.length) {
    return {
      ok: false,
      tabs: [],
      error: `无法解析标签列表（原始 ${raw.length} 字符）。请重试或检查自动化权限。`,
    };
  }
  return { ok: true, tabs, error: null };
}

function pickNoteTab(tabs) {
  const notes = tabs.filter((t) => isNoteDetailUrl(t.url));
  if (!notes.length) return null;
  const score = (t) => {
    let s = 0;
    if (t.active) s += 10;
    try {
      if (new URL(t.url).searchParams.has("xsec_token")) s += 5;
    } catch {
      /* ignore */
    }
    // 更靠前的窗口略优先
    s += Math.max(0, 3 - t.windowIndex);
    return s;
  };
  notes.sort((a, b) => score(b) - score(a));
  return notes[0];
}

function appleQuote(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * 在指定标签执行 JS 字符串，返回 stdout 文本。
 * 不 activate、不 goto、不新建窗口。
 */
function executeChromeJs(windowIndex, tabIndex, jsSource, { timeoutMs = 30_000 } = {}) {
  const tmpDir = process.env.TMPDIR || "/tmp";
  const jsPath = join(tmpDir, `xhs-js-${process.pid}-${Date.now()}.js`);
  writeFileSync(jsPath, jsSource, "utf8");
  const as = `
set jsPath to ${appleQuote(jsPath)}
set js to read POSIX file jsPath as «class utf8»
tell application "Google Chrome"
  try
    set r to execute tab ${Number(tabIndex)} of window ${Number(windowIndex)} javascript js
    return r
  on error errMsg number errNum
    return "XHS_AE_ERR:" & errNum & ":" & errMsg
  end try
end tell
`;
  const r = spawnSync("osascript", ["-e", as], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 15 * 1024 * 1024,
  });
  try {
    rmSync(jsPath, { force: true });
  } catch {
    /* ignore */
  }
  if (r.status !== 0) {
    return { ok: false, raw: "", error: (r.stderr || r.stdout || "osascript failed").trim() };
  }
  const raw = String(r.stdout || "").trim();
  if (raw.startsWith("XHS_AE_ERR:")) {
    const msg = raw.slice("XHS_AE_ERR:".length);
    let hint = "";
    if (/允许|Apple|JavaScript|not allowed|error 8|errAE/i.test(msg)) {
      hint =
        "\n请在 Chrome 菜单开启：查看 → 开发者 → 允许 Apple 事件中的 JavaScript";
    }
    return { ok: false, raw, error: msg + hint };
  }
  return { ok: true, raw, error: null };
}

function extractViaAppleEvents(windowIndex, tabIndex) {
  const payload = `JSON.stringify(${EXTRACT_JS})`;
  const ran = executeChromeJs(windowIndex, tabIndex, payload);
  if (!ran.ok) {
    return { ok: false, note: null, error: ran.error };
  }

  const data = parseEvalOutput(ran.raw);
  if (!data || typeof data !== "object") {
    return { ok: false, note: null, error: `页面 JS 返回无法解析: ${ran.raw.slice(0, 200)}` };
  }

  if (data.flags?.securityBlock) {
    return { ok: false, note: null, error: "页面安全限制" };
  }
  if (data.flags?.loginWall) {
    return { ok: false, note: null, error: "需要登录" };
  }
  if (data.flags?.notFound) {
    return { ok: false, note: null, error: "笔记不存在" };
  }

  const note = {
    pageUrl: data.pageUrl || "",
    noteId: data.noteId || null,
    title: String(data.title || ""),
    desc: String(data.desc || ""),
    author: String(data.author || ""),
    authorId: String(data.authorId || ""),
    likes: data.likes ?? null,
    collects: data.collects ?? null,
    comments: data.comments ?? null,
    shares: data.shares ?? null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    images: Array.isArray(data.images) ? data.images : [],
    ipLocation: String(data.ipLocation || ""),
    publishTime: String(data.publishTime || ""),
    sources: Array.isArray(data.sources) && data.sources.length ? data.sources : ["dom"],
    flags: data.flags || {},
  };
  return { ok: true, note, error: null };
}

// 评论区：在原 tab 滚动加载 + DOM 抽取
const COMMENTS_SCROLL_JS = `(() => {
  const scroller = document.querySelector('.note-scroller')
    || document.querySelector('.comments-container')
    || document.querySelector('.container')
    || document.scrollingElement;
  if (!scroller) return 0;
  scroller.scrollTo(0, scroller.scrollHeight);
  return scroller.querySelectorAll('.parent-comment, .comment-item').length;
})()`;

function buildCommentsExtractJs(withReplies) {
  return `(() => {
  const withReplies = ${withReplies ? "true" : "false"};
  const clean = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  const parseLikes = (el) => {
    const raw = clean(el).replace(/[,，\\s]/g, '');
    if (!raw || /^(赞|点赞)$/.test(raw)) return 0;
    if (/^\\d+$/.test(raw)) return Number(raw);
    const m = raw.match(/^([\\d.]+)([wWkK万千])$/);
    if (!m) return 0;
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const mul = (unit === 'w' || unit === '万') ? 10000 : 1000;
    return Math.round(n * mul);
  };
  const HREF_SEL = '.author-wrapper a[href*="/user/profile/"], a.name[href*="/user/profile/"], a.user-name[href*="/user/profile/"], a[href*="/user/profile/"]';
  const extractHref = (el) => {
    if (!el) return '';
    const a = el.querySelector(HREF_SEL);
    return a ? (a.getAttribute('href') || '') : '';
  };
  // 尽量点开「展开回复」
  if (withReplies) {
    const expanders = Array.from(document.querySelectorAll('button, [role="button"], span, div')).filter(el => {
      if (!(el instanceof HTMLElement)) return false;
      const text = clean(el);
      if (!text || text.length > 28) return false;
      return /(展开|更多回复|全部回复|查看.*回复|共\\d+条回复)/.test(text);
    });
    expanders.slice(0, 20).forEach(el => { try { el.click(); } catch(e) {} });
  }

  const results = [];
  const parents = document.querySelectorAll('.parent-comment');
  if (parents.length) {
    parents.forEach(pc => {
      const author = clean(pc.querySelector('.author, .name, .user-name, .author-wrapper .name'));
      const authorHref = extractHref(pc);
      const text = clean(pc.querySelector('.content, .note-text, .comment-inner .content'));
      const likes = parseLikes(pc.querySelector('.like-wrapper .count, .count, .like-count'));
      const time = clean(pc.querySelector('.date, .time, .comment-time'));
      if (!text) return;
      results.push({ author, authorHref, text, likes, time, is_reply: false, reply_to: '' });
      if (withReplies) {
        pc.querySelectorAll('.reply-container .comment-item, .replies .comment-item, .sub-comment, .reply-item').forEach(sub => {
          const sAuthor = clean(sub.querySelector('.author, .name, .user-name'));
          const sHref = extractHref(sub);
          const sText = clean(sub.querySelector('.content, .note-text'));
          const sLikes = parseLikes(sub.querySelector('.count, .like-count'));
          const sTime = clean(sub.querySelector('.date, .time'));
          if (!sText) return;
          results.push({ author: sAuthor, authorHref: sHref, text: sText, likes: sLikes, time: sTime, is_reply: true, reply_to: author });
        });
      }
    });
  } else {
    // 兜底：通用评论节点
    document.querySelectorAll('.comment-item, [class*="comment-item"]').forEach(el => {
      const author = clean(el.querySelector('.author, .name, .user-name'));
      const text = clean(el.querySelector('.content, .note-text, .comment-content'));
      if (!text || text.length < 1) return;
      results.push({
        author,
        authorHref: extractHref(el),
        text,
        likes: parseLikes(el.querySelector('.count')),
        time: clean(el.querySelector('.date, .time')),
        is_reply: false,
        reply_to: '',
      });
    });
  }
  return JSON.stringify({
    pageUrl: location.href,
    count: results.length,
    results,
  });
})()`;
}

function extractCommentsViaAppleEvents(windowIndex, tabIndex, { limit = 40, withReplies = true } = {}) {
  // 滚动几次触发懒加载（仍在用户已打开的 tab，不导航）
  let last = -1;
  for (let i = 0; i < 5; i++) {
    const scrolled = executeChromeJs(windowIndex, tabIndex, COMMENTS_SCROLL_JS, {
      timeoutMs: 10_000,
    });
    const n = Number(scrolled.raw) || 0;
    if (n <= last && i > 0) break;
    last = n;
    sleep(900);
  }
  // 再点一次展开后稍等
  if (withReplies) sleep(600);

  const ran = executeChromeJs(
    windowIndex,
    tabIndex,
    buildCommentsExtractJs(withReplies),
    { timeoutMs: 45_000 },
  );
  if (!ran.ok) {
    return { ok: false, comments: [], error: ran.error };
  }
  const data = parseEvalOutput(ran.raw);
  if (!data || !Array.isArray(data.results)) {
    return { ok: false, comments: [], error: `评论解析失败: ${ran.raw.slice(0, 160)}` };
  }

  const parseUserId = (href) => {
    const m = String(href || "").match(/\/user\/profile\/([a-zA-Z0-9]+)/);
    return m ? m[1] : "";
  };

  let list = data.results.map((c, i) => ({
    rank: i + 1,
    author: c.author || "",
    userId: parseUserId(c.authorHref),
    profileUrl: parseUserId(c.authorHref)
      ? `https://www.xiaohongshu.com/user/profile/${parseUserId(c.authorHref)}`
      : "",
    text: c.text || "",
    likes: c.likes ?? 0,
    time: c.time || "",
    is_reply: Boolean(c.is_reply),
    reply_to: c.reply_to || "",
  }));

  // limit 只计一级评论；楼中楼随父评论带上
  if (withReplies) {
    const limited = [];
    let top = 0;
    for (const c of list) {
      if (!c.is_reply) top += 1;
      if (top > limit) break;
      limited.push(c);
    }
    list = limited;
  } else {
    list = list.filter((c) => !c.is_reply).slice(0, limit);
  }
  // 重编号
  list = list.map((c, i) => ({ ...c, rank: i + 1 }));

  return {
    ok: true,
    comments: list,
    error: null,
    total_extracted: data.results.length,
  };
}

/** deep：从当前标签读 outerHTML，仍不导航 */
function getRawHtmlViaAppleEvents(windowIndex, tabIndex) {
  const as = `
tell application "Google Chrome"
  try
    return execute tab ${Number(tabIndex)} of window ${Number(windowIndex)} javascript "document.documentElement.outerHTML"
  on error
    return ""
  end try
end tell
`;
  const r = spawnSync("osascript", ["-e", as], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  const html = String(r.stdout || "");
  return html.length > 100 ? html : null;
}

/**
 * 截图：只截该 Chrome 窗口（不切 tab）。
 * 若笔记不在该窗当前可见 tab，图可能不是笔记——仅作辅助。
 */
function screenshotChromeWindow(windowIndex, noteId) {
  const as = `
tell application "Google Chrome"
  try
    return id of window ${Number(windowIndex)} as text
  on error
    return ""
  end try
end tell
`;
  const idR = spawnSync("osascript", ["-e", as], { encoding: "utf8", timeout: 5_000 });
  const winId = String(idR.stdout || "").trim();
  if (!winId) return null;

  const shotPath = join(
    process.env.TMPDIR || "/tmp",
    `xhs-cap-${noteId || "note"}-${Date.now()}.png`,
  );
  const cap = spawnSync("screencapture", ["-x", "-l", winId, shotPath], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (cap.status === 0 && existsSync(shotPath) && statSync(shotPath).size > 0) {
    return shotPath;
  }
  try {
    rmSync(shotPath, { force: true });
  } catch {
    /* ignore */
  }
  return null;
}

// ── main capture ─────────────────────────────────────────────────

function fail(msg, code) {
  console.error(msg);
  process.exit(code);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  if (args.list) {
    process.exit(listCaptures(args.outRoot, args.limit));
  }

  console.error("→ 枚举 Chrome 标签（AppleScript，不导航）…");
  const listed = listChromeTabs();
  if (!listed.ok) {
    fail(
      `无法读取 Chrome 标签。\n${listed.error}\n请在「系统设置 → 隐私与安全性 → 自动化」允许「终端/快捷指令」控制 Google Chrome。`,
      EXIT.ENV,
    );
  }

  const tab = pickNoteTab(listed.tabs);
  if (!tab) {
    const preview = listed.tabs
      .slice(0, 8)
      .map((t) => `[w${t.windowIndex}/t${t.tabIndex}${t.active ? "*" : ""}] ${t.url}`)
      .join("\n  ");
    fail(
      `Chrome 里没找到小红书笔记详情页（共 ${listed.tabs.length} 个标签）。\n当前预览:\n  ${preview}\n请先打开笔记详情（URL 含 /explore/ 或 /discovery/item/ 等）。`,
      EXIT.FAIL,
    );
  }

  const pageUrl = tab.url;
  const noteIdFromUrl = parseNoteId(pageUrl);
  console.error(`→ 目标笔记: ${noteIdFromUrl || "?"}  (window ${tab.windowIndex} tab ${tab.tabIndex})`);
  console.error(`  ${pageUrl.slice(0, 120)}${pageUrl.length > 120 ? "…" : ""}`);

  console.error("→ 在原标签只读抽取（Apple Events JS，不开新窗、不 goto）…");
  const extracted = extractViaAppleEvents(tab.windowIndex, tab.tabIndex);
  if (!extracted.ok || !extracted.note) {
    fail(
      `抽取失败: ${extracted.error || "unknown"}\n` +
        "若提示不允许执行 JS：Chrome → 查看 → 开发者 → 勾选「允许 Apple 事件中的 JavaScript」。",
      /允许|JavaScript|Apple/i.test(extracted.error || "") ? EXIT.ENV : EXIT.FAIL,
    );
  }

  let note = extracted.note;
  note.pageUrl = note.pageUrl || pageUrl;
  note.noteId = note.noteId || noteIdFromUrl;

  if (note.flags?.securityBlock) {
    fail("页面触发安全限制，无法读取。", EXIT.FAIL);
  }

  let comments = null;
  if (args.comments) {
    console.error(
      `→ 抓评论（原 tab 滚动加载，limit=${args.commentsLimit}，replies=${args.withReplies}）…`,
    );
    const cr = extractCommentsViaAppleEvents(tab.windowIndex, tab.tabIndex, {
      limit: args.commentsLimit,
      withReplies: args.withReplies,
    });
    if (!cr.ok) {
      console.error(`  (评论失败: ${cr.error}，正文仍保存)`);
      comments = [];
    } else {
      comments = cr.comments;
      console.error(
        `  抓到 ${comments.length} 条（页面共见约 ${cr.total_extracted}）`,
      );
    }
  }

  console.error("→ 截图（screencapture 窗口）…");
  const shotPath = screenshotChromeWindow(tab.windowIndex, note.noteId);
  if (!shotPath) console.error("  (截图跳过/失败，正文仍保存)");

  let rawHtml = null;
  if (args.deep) {
    console.error("→ deep: 读 raw html…");
    rawHtml = getRawHtmlViaAppleEvents(tab.windowIndex, tab.tabIndex);
  }

  const hasContent = Boolean(
    (note.desc && String(note.desc).trim()) || (note.title && String(note.title).trim()),
  );
  if (!hasContent) {
    fail(
      "未能提取到标题或正文。可能页未加载完，或未开启「允许 Apple 事件中的 JavaScript」。",
      EXIT.FAIL,
    );
  }

  const { dir, meta } = writePackage({
    outRoot: args.outRoot,
    note,
    deep: args.deep,
    shotPath,
    network: null,
    rawHtml,
    comments,
  });

  // deep 下图：curl 拉已解析到的图片 URL
  if (args.deep && meta.images?.length) {
    console.error("→ deep: curl 下载图片 URL…");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        quality: meta.quality,
        note_id: meta.note_id,
        title: meta.title,
        author: meta.author,
        path: dir,
        deep: args.deep,
        source: meta.source,
        missing: meta.missing,
        comments_captured: meta.comments_captured ?? 0,
        mode: "apple-events-readonly",
      },
      null,
      2,
    ),
  );

  if (meta.quality === "degraded") {
    console.error(`⚠ 降级保存 → ${dir}`);
    process.exit(EXIT.DEGRADED);
  }
  console.error(`✓ 已保存 → ${dir}`);
  process.exit(EXIT.OK);
}

main();
