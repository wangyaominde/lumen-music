# Lumen Music

> 自托管的本地无损音乐流媒体服务。一个进程提供 API 与前端，浏览器播放，浏览器随处可达。

完整覆盖 **FLAC / ALAC / WAV / AIFF / DSF / DFF / APE / WavPack / MP3 / OGG / OPUS** 的浏览与流式播放。无需外部账号、无需 Docker，单二进制级别的部署体积（13 MB tar.gz）。

---

## 功能

### 音乐库
- 递归扫描本地目录，**增量识别**（`mtime` 跳过未变文件，扫尾自动清理失踪条目）
- 用 [`music-metadata`](https://github.com/Borewit/music-metadata) 解析 ID3v2 / Vorbis / MP4 atoms / APEv2，UTF-8 优先
- **专辑去重**按 `(album_name, album_artist)` 配对而非 `(name, artist)` —— 同张专辑里出现不同曲目艺人时不会被拆成多张
- 多碟、年代、流派、码率、采样率、位深、声道、容器等全字段索引
- 一首歌的所有元数据在曲目页可见（含 `Hi-Res / 24/192` 标识）

### 元数据"刮削器"
- 三层数据源：**MusicBrainz**（国际权威）→ **NetEase 网易云**（type=10 album 搜索）→ **Kugou 酷狗**（CN 网络下原版补盲）
- MB 候选按 release-group 类型加权选 canonical 版本（Album > EP > Single，避开 Compilation/Live/Remix）
- 简繁汉字 1-字符差异容错（`周杰伦 ↔ 周杰倫` 自动识别为同一艺人）
- **三入口**：首页一键刮全库 / 专辑页单专辑刮 / 曲目级 ✨ 候选选择对话框
- 自动模式高度严格：仅 MB 高分匹配 + NetEase 同名同艺人才会自动应用，避免错配翻唱
- 1 r/s MB 限速合规 + 阶梯式重试

### 播放体验
- HTTP Range 流式播放，浏览器拖进度条秒到位
- **默认永远原始无损**，绝不悄悄转码；弱网/车载嫌卡时，可在「设置 → 音质」手动切到 AAC 256k/128k 省流（需服务器装 ffmpeg），随时切回
- **断网自愈**：蜂窝掉线（隧道 / 地库）自动按 1→2→4→8→15s 退避重试，网络恢复瞬间续播，从断点继续
- **下一首预取**：临近曲尾预热下一首的首个分片（Chromium），切歌近乎无缝
- **Web Audio AnalyserNode 真实频谱可视化**（fftSize=64，单实例 + rAF 直绘 DOM，资源消耗近乎零；移动端自动绕过 Web Audio 以保证锁屏后台播放）
- 全屏 Now Playing：从专辑封面提取主色 → 双径向渐变 + 模糊大图背景，**真实**支持同步歌词（本地 `.lrc` 文件 / NetEase 严格匹配回退）
- 媒体键支持（macOS 触控栏 / OS 通知中心）
- 播放队列、随机、单曲循环、列表循环
- 音量、收藏、播放列表、搜索

### 多用户与安全
- **两级角色**：首次访问设置的人是 **管理员**（可扫描、刮削、管理用户）；管理员可以在「设置 → 用户管理」给家人添加 **听众**（只能浏览/播放/收藏/改自己的 PIN）
- **PIN 即身份**：每个用户一个 6 位 PIN，登录只输 PIN（不需要用户名）；PIN 不能跟其他人重复，创建时即拒
- **httpOnly cookie session**（30 天，反代 HTTPS 时自动开 `Secure` 标志），admin/listener 中间件全局生效
- scrypt 哈希（N=16384, r=8, p=1，无外部依赖，纯 Node 内置 crypto）
- 阶梯式登录节流（错 1 次冷却 1s → 2 → 5 → 10 → 30 → 60s，登录成功清零）
- 首次访问自动进入「设置 PIN」页，6 位数字 OTP 风格输入
- 反爬美化：3D 数字粒子球背景，正确输入时数字粒子飞入对应输入框 + 验证对勾动画

### UI
- 暗色磨砂玻璃风（自研色板提取算法，无外部 dep）
- Framer Motion 页面过渡 + 微动效
- 响应式布局
- 键盘快捷键

---

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Node.js 20+ · Fastify 5 · better-sqlite3 · music-metadata · @fastify/cookie |
| 前端 | React 19 · Vite 6 · TypeScript · Tailwind v4 · Framer Motion · Zustand · TanStack Query · React Router |
| 持久化 | SQLite (单文件) · WAL 模式 · 外键约束 |
| 鉴权 | scrypt + httpOnly cookie session |
| 包管理 | pnpm workspace |

源码总量 **~580 KB**（不含依赖），生产部署 bundle **54 MB / 13 MB gz**。

---

## 快速开始

### 开发模式

```bash
git clone https://github.com/wangyaominde/lumen-music.git
cd lumen-music
pnpm install
pnpm dev      # server: :4477  web: :5173
```

打开 http://localhost:5173 →
1. 设置 6 位 PIN（首次访问的人成为管理员）
2. 「设置 → 音乐库目录」添加目录 → 开始扫描
3. 首页 → ✨ 一键刮削整库（修补缺失元数据，自动识别 GBK/Big5 乱码）
4. 想给家人分享 → 「设置 → 用户管理」添加听众 PIN（只能听不能管理）

### CLI 直接扫描

```bash
pnpm scan /path/to/your/music
```

### 生产部署

```bash
pnpm package          # 输出到 ./release/，54 MB
pnpm package:tar      # 同上 + 打包 lumen-music.tar.gz (13 MB)
```

把 `release/` 整个目录拷到目标机器：

```bash
tar -xzf lumen-music.tar.gz -C /opt/lumen-music
cd /opt/lumen-music
./start.sh            # 监听 :4477
```

跨平台（如 macOS 编译 → Linux 部署），首次需要重建 SQLite 原生绑定：

```bash
cd server && npm rebuild better-sqlite3
```

详细部署文档（systemd、Caddy / Nginx 反代示例）在 `release/README.md`。

---

## 配置

通过环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `4477` | 监听端口 |
| `HOST` | `0.0.0.0` | 绑定地址 |
| `LUMEN_DATA_DIR` | `./data` | SQLite 数据库 + 封面图存放位置 |
| `LUMEN_FFMPEG` | (PATH 探测) | ffmpeg 可执行文件路径；找到即启用 AAC 转码与封面缩图，找不到自动禁用 |
| `NODE_ENV` | (unset) | `production` 时 cookie `Secure` 标志启用，HTTPS 反代后必设 |

---

## 数据位置

| 路径 | 内容 |
|---|---|
| `data/library.db` | 曲目 / 专辑 / 艺人 / 播放列表 / 收藏 / 用户 (PIN 哈希 + 角色) / session |
| `data/covers/` | 提取或刮取的专辑封面（按 `sha1(album_name + album_artist)` 命名）|
| `data/cache/covers/` | 按需生成的封面缩图（96/320/800px），可随时整目录删除 |

仅 `data/` 需要持久化备份。丢了不会丢源文件，但要重新扫描 + 重设 PIN。

---

## 扫描准确性

| 策略 | 说明 |
|---|---|
| 增量 | `mtime` **+** `file_size` 双重检查跳过未变文件，原地替换更高音质（含 `cp -p` 保留时间戳）也能识别 |
| 专辑去重 | `(album_name, album_artist)` 配对，避免同专辑因不同曲目艺人被分裂 |
| 优先 albumartist | 分组按 `albumartist` 标签，回退到 track artist |
| 路径推断 | 当 tag 缺失，从 `Artist/Album/Track.flac` 或 `Artist - Title.flac` 路径反推 |
| **乱码自动修复** | ID3v2.3 的 GBK / Big5 / Shift_JIS 标签被错当成 Latin-1 时，自动逆向重编码（`ºÚÉ«ÓÄÄ¬` → `黑色幽默`），CJK 命中后才采用；无法恢复的 fallback 到文件名 |
| 封面提取 | 内嵌图 → 文件夹 `cover.jpg`/`folder.jpg`/`front.jpg`/`AlbumArt.jpg` |
| 扫尾清理 | 文件被删后下次扫描自动从索引移除 |
| 流缓存失效 | `/api/stream` 的 ETag 绑定 (size, mtime)，文件一换浏览器立刻拿到新版本 |

---

## 浏览器格式支持

| 格式 | 浏览器原生播放 | 流式传输 |
|---|---|---|
| FLAC | ✅ Chrome / Firefox / Edge / Safari 16+ | ✅ |
| ALAC (m4a) | ✅ Safari，部分 Chrome | ✅ |
| WAV / AIFF | ✅ 全部 | ✅ |
| MP3 / OGG / OPUS | ✅ 全部 | ✅ |
| APE / WavPack / DSF / DFF | ❌ | ⚠️ 原始字节流（需后续转码层）|

---

## 键盘快捷键

全局生效。在输入框 / textarea / contenteditable 内自动让位；按 Cmd / Ctrl / Alt 修饰键时不拦截，所以 `Cmd+R` 等浏览器原生快捷键照常工作。

| 键 | 行为 |
|---|---|
| `Space` | 播放 / 暂停 |
| `←` / `→` | 上一首 / 下一首 |
| `Esc` | 收起 Now Playing（仅在 Now Playing 打开时）|

---

## 安全注意事项

- **首次访问立刻设管理员 PIN**，避免被路过陌生人抢先初始化为 admin
- **HTTPS 反代后必须设 `NODE_ENV=production`**，否则 cookie 不会带 `Secure` 标志
- 听众 (`listener`) 角色拿不到 `/api/scan` `/api/enrich` `/api/users` 任何端点（403），管理员发出的 PIN 即使被泄露也只能听歌
- session 在 SQLite 持久化（`sessions` 表），管理员重置某用户的 PIN 时会自动撤销该用户所有设备的会话
- 鉴权对所有 `/api/*` 全局生效（除 `/api/auth/login|setup|status|logout`），包括音频流和封面 —— 没有 cookie 拿不到任何内容

---

## 忘记管理员 PIN？

在服务器上（能登录主机 shell 即视为身份验证）执行：

```bash
# 部署包目录下（LUMEN_DATA_DIR 按实际路径调整，默认 ./data）
LUMEN_DATA_DIR=./data node server/dist/tools/reset-admin.js 654321
```

会把**第一个管理员**的 PIN 重置为给定的 6 位数字，并注销该管理员所有设备上的登录会话（听众账号不受影响）。之后可在「设置」里再改成别的。

---

## 已知限制

- MB API 限速 1 r/s 是硬限制，整库刮削大库 (1k+ 曲目) 需要数分钟
- 部分艺人（如 Jay Chou）在 NetEase / Kugou 因版权下架，原版封面/歌词无源可拿，需手动放 `cover.jpg` 到专辑文件夹
- 浏览器无法原生播放 APE / DSD，目前直传字节流（计划加 ffmpeg 转码层）
- FLAC 文件如果元数据被错误编码已经写死了 `�` 替换字符（lossy），无法逆向恢复，scanner 会自动 fallback 到文件名
- 收藏 / 播放列表当前是**全用户共享**的（适合家庭共享场景）；如果需要每人独立的"喜欢"，欢迎提 issue

---

## 项目结构

```
.
├── server/                 # Node.js 后端
│   └── src/
│       ├── index.ts            # Fastify entry + auth gate (admin/listener)
│       ├── auth.ts             # scrypt + users + sessions
│       ├── scanner.ts          # 文件扫描 + path heuristics + GBK 乱码修复
│       ├── enrich.ts           # MB / NetEase / Kugou scraper
│       ├── db.ts               # SQLite schema + migration
│       └── routes/             # API 路由（含 users CRUD）
├── web/                    # React 前端
│   └── src/
│       ├── pages/              # Home / Albums / Album / Artist / Search / Settings / Login ...
│       ├── components/         # PlayerBar / NowPlaying / EnrichDialog / EqBars ...
│       ├── store/              # Zustand stores (player / auth / ui)
│       ├── lib/                # color extraction / lrc parser / format
│       └── api/
└── scripts/
    └── package.mjs         # 生产构建打包脚本
```

---

## License

MIT — see [LICENSE](./LICENSE).

致谢：[music-metadata](https://github.com/Borewit/music-metadata)、[Fastify](https://fastify.dev)、[MusicBrainz](https://musicbrainz.org)。
