# 诗境 · 以君之意，成君之诗

移动端优先的古诗生成应用：用户写下一段意境描述，应用先解析意象，再依体裁与格律成诗，最后由程序逐字校验。设计依据 `古诗生成提示词设计方案 v2.0`。

## 线上环境（已部署）

| 项 | 值 |
| --- | --- |
| 访问地址 | 以 Cloudflare 后台 Pages 项目域名为准 |
| Pages 项目 | `yinshi`（账号 Soralabe@126.com，Git 集成项目，推送 main 自动部署） |
| D1 数据库 | `yinshi-db` · `9b71a641-1fe2-47c8-a38b-29237acfc9dd` |
| 管理员账号 | `admin` / `admin123456`（登录后请尽快改密码） |
| 环境变量 | `JWT_SECRET`（secret）、`ADMIN_USERNAME=admin`、`PBKDF2_ITERATIONS=100000` |

更新线上版本：

```bash
npm run build     # 输出 dist/
npx wrangler pages deploy dist --project-name=yinshi --branch=main
```

> 该项目为「直传型」Pages 项目，推送到 GitHub 不会自动部署，需要执行上面的命令；
> 若想要 Git 自动部署，可在 Cloudflare 后台新建一个 Git 集成项目并指向本仓库。

## 功能

| 模块 | 说明 |
| --- | --- |
| 落地页 | 竖排宣纸首屏、示例作品横滑、三步流程、注册入口 |
| 创作台 | 意境输入（120 字 + 快捷示例）、体裁（五/七言）、风格（婉约/豪放/冲淡/绮丽/雄浑）、格律档位（严格/宽松） |
| 三段式生成 | ① 意象解析先行返回并渲染意象卡片 ② 格律成诗 ③ 程序校验（字数/韵脚），不合格自动修复一次 |
| 诗笺 | 逐句渐显、二四句韵脚朱砂下划线、白话释义折叠、复制、换一首、本机收藏 |
| 账号体系 | 注册 / 登录 / 退出，PBKDF2-SHA256（10 万次迭代）+ HttpOnly 签名 Cookie |
| 管理后台 | 仅管理员可见：用户列表 + 文章管理（增删改查、草稿/发布切换） |
| 诗话（博客） | 前台 `/blog.html` 列表、`/post.html?slug=` 详情；封面支持图床外链，正文支持 Markdown（标题/引用/列表/表格/代码块/图片） |
| 文章编辑器 | `/admin-editor.html` 左编辑右预览，实时 Markdown 渲染、封面链接加载校验、Ctrl+S 保存 |
| 品牌资源 | `favicon.ico`（16/32/48 多尺寸）、`icon.svg`、`apple-touch-icon.png`、`manifest.webmanifest`（PWA） |

## 快速开始

```bash
cd poem-app
node server/index.js          # 或 npm start
# 终端输出：启动中: http://localhost:<port>/
```

默认端口随机；固定端口：

```bash
PORT=5180 ADMIN_USERNAME=admin node server/index.js
```

- 未配置任何模型 Key 时自动进入**演示模式**（本地诗词库，页面右上角有标识），可直接体验完整流程。
- 管理员：把 `ADMIN_USERNAME` 设成某个用户名，用该用户名注册即自动获得管理员权限（避免"第一个注册者即管理员"被抢注）。

## 环境变量

复制 `.env.example` 后按需填写（本服务直接读取进程环境变量）：

| 变量 | 作用 |
| --- | --- |
| `MODELSCOPE_API_KEY` | 魔搭 ModelScope 主通道（OpenAI 兼容） |
| `SENSENOVA_API_KEY` | 商汤日日新备用通道（单 Key，直接作为 Bearer） |
| `SENSENOVA_AK` / `SENSENOVA_SK` | 商汤日日新备用通道（AK/SK 换 JWT，与单 Key 二选一） |
| `JWT_SECRET` | 会话签名密钥，生产必须替换 |
| `ADMIN_USERNAME` | 管理员用户名 |
| `PBKDF2_ITERATIONS` | 密码迭代次数，免费实例可降到 20000 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | 配置后注册/生成需通过人机验证 |
| `PORT` | 固定端口，默认随机 |

Key 只存在于服务端环境变量，前端代码中不出现任何密钥。

## 提示词与参数

三段提示词分别位于 `server/model.js` 的 `IMAGERY_SYSTEM` / `POEM_SYSTEM` / `FIX_SYSTEM`，与设计文档一致：

| 阶段 | temperature | top_p | max_tokens |
| --- | --- | --- | --- |
| ① 意象解析 | 0.3 | 0.8 | 200 |
| ② 格律成诗 | 0.85 | 0.9 | 400 |
| ③ 校对修复 | 0.2 | 0.7 | 300 |

降级链：魔搭 → 商汤 → 本地演示库。生成结果按 `sha256(意象+体裁+风格+档位)` 缓存 24 小时；「换一首」携带 avoid 参数绕过缓存。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/imagery` | ① 意象解析（需登录） |
| POST | `/api/poem` | ② 成诗 + ③ 校验（需登录） |
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/auth/me` | 当前登录态 |
| GET | `/api/admin/users` | 用户列表（仅管理员） |
| GET | `/api/posts` | 已发布文章列表（公开） |
| GET | `/api/posts/:slug` | 文章详情（公开；草稿仅管理员可见） |
| GET | `/api/admin/posts` | 全部文章 + 统计（仅管理员） |
| POST | `/api/admin/posts` | 新建文章（仅管理员） |
| GET/PUT/DELETE | `/api/admin/posts/:id` | 读取 / 编辑 / 删除文章（仅管理员） |
| GET | `/api/config` | Turnstile sitekey / 演示模式 |
| GET | `/api/health` | 健康检查 |

## 目录结构

```
poem-app/
├─ public/                  静态页面（Pages 可直接托管）
│  ├─ index.html            落地页
│  ├─ app.html              创作台
│  ├─ login.html  register.html  admin.html
│  ├─ blog.html  post.html            诗话列表 / 文章详情
│  ├─ admin-posts.html  admin-editor.html  文章管理 / 编辑器
│  ├─ favicon.ico  manifest.webmanifest
│  └─ assets/css|js|img
├─ server/
│  ├─ index.js              HTTP 服务与路由
│  ├─ model.js              三段提示词 + 双通道模型适配
│  ├─ poems.js              演示诗词库、意象解析、成诗与校验
│  └─ store.js              JSON 存储、PBKDF2、会话、缓存、频控
├─ data/db.json             本地用户库（首次启动自动生成）
├─ schema.sql               Cloudflare D1 建表脚本
└─ dev/                     开发期校验脚本与截图（不参与运行）
```

## 部署到 Cloudflare Pages

仓库已内置 Pages 适配：`functions/api/[[path]].js` 提供全部接口，`scripts/build.mjs` 把 `public/` 输出到 `dist/`。

### 1. 构建配置

| 项 | 值 |
| --- | --- |
| 构建命令 | `npm run build` |
| 输出目录 | `dist`（`wrangler.toml` 的 `pages_build_output_dir` 已声明） |
| 兼容性标志 | `nodejs_compat` |

### 2. 创建并初始化 D1

```bash
npx wrangler login
npx wrangler d1 create yinshi-db          # 复制返回的 database_id
# 把 database_id 填入 wrangler.toml 的 [[d1_databases]] 并取消该段注释
npx wrangler d1 execute yinshi-db --remote --file=./schema.sql
```

> 未绑定 D1 时接口会自动降级为「实例内存」模式：功能可用，但实例重启后数据清空（`/api/health` 的 `persistent` 字段可判断）。

### 3. 环境变量（Pages 项目 → Settings → Variables and Secrets）

| 变量 | 说明 |
| --- | --- |
| `ADMIN_USERNAME` | 该用户名注册即自动成为管理员 |
| `JWT_SECRET` | 会话签名密钥，务必替换为随机串 |
| `MODELSCOPE_API_KEY` | 可选，配置后切换为真实模型通道 |
| `SENSENOVA_API_KEY` 或 `SENSENOVA_AK`+`SENSENOVA_SK` | 可选，备用通道（二选一） |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | 可选，人机验证 |

### 4. 本地验证 Pages 运行时

```bash
npm run preview        # 等价于 wrangler pages dev dist --d1 DB
```

### 5. 自动部署

推送到 `main` 即触发 Pages 构建；构建命令与输出目录按上表配置即可，无需额外脚本。

### 与本地 Node 版的差异

| 能力 | 本地 Node（server/） | Pages Functions（functions/） |
| --- | --- | --- |
| 存储 | `data/db.json` | D1（未绑定则内存） |
| 密码哈希 | `node:crypto` PBKDF2 | WebCrypto PBKDF2（10 万次） |
| 会话 | HMAC 签名 Cookie | 同左，WebCrypto 签名 |
| 生成缓存 / 频控 | 进程内存 | 实例内存（多实例下为尽力而为） |
| 提示词 | `shared/prompts.js`（两端共用） | 同左 |

## 验收清单

- [x] 未登录访问 `/app.html` 跳转登录，登录后回跳
- [x] 注册 → 生成 → 意象卡片 → 逐句渐显 → 韵脚标注
- [x] 换一首返回不同诗作；释义折叠、复制、收藏、诗笺抽屉
- [x] 程序校验：五言 5 字 / 七言 7 字、二四句韵脚
- [x] 非管理员访问 `/admin.html` 显示 403 视图
- [x] 移动端 390px：顶栏不换行、卡片横滑、按钮触控区 ≥ 44px
- [x] 文章：新建草稿 → 编辑 → 发布 → 前台可见 → 删除，全流程通过
- [x] 非管理员访问文章管理/编辑器被拦截
- [x] 图床封面加载失败时降级为「诗话」占位，不出现破图
- [ ] 真实模型通道（需自备 API Key 后验证）
- [ ] Turnstile 前端挂件（需配置 sitekey 后验证）


## 博客（诗话）使用说明

1. 用管理员账号登录，进入 `/admin-posts.html`；
2. 点「新建文章」，填写标题、摘要、封面图床链接（`https://` 开头，右侧即时显示加载结果与尺寸）；
3. 正文使用 Markdown，右侧实时预览；支持 `## 标题`、`> 引用`、`- 列表`、表格、代码块、`![](图片地址)`；
4. 「保存草稿」仅后台可见，「发布」后立刻出现在 `/blog.html`；
5. 列表页支持「下线 / 编辑 / 删除」，删除需二次确认。

> 封面图建议 16:9 或 21:9 横图；外链需允许跨域直链访问，加载失败时前台自动降级为文字占位。
