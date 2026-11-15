# 诗境 · 以君之意，成君之诗

移动端优先的古诗生成应用：用户写下一段意境描述，应用**先把它润色成一份可编辑的「意境稿」**，再依体裁与格律成诗，最后由程序逐字校验、只补坏句。

> 为什么要有「意境稿」这一步：只把描述里抽出来的 4~5 个意象词喂给模型，模型只能自己编故事，写出来必然"不搭"。成诗那一步必须看到完整的稿子。

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

> **推送 GitHub 会不会自动上线，取决于这个 Pages 项目当初怎么建的：**
> - **Git 集成**：推到 `main` 后自动构建部署，1~3 分钟生效；
> - **直传型**：推 GitHub 不会上线，必须执行上面的 `wrangler pages deploy`。
>
> 判断办法：推完看一眼线上内容有没有变；或在 Cloudflare 控制台该项目里看有没有 Git 仓库信息。
> 两种都不是的第三种情况不存在 —— 别靠猜，靠看。

## 功能

| 模块 | 说明 |
| --- | --- |
| 落地页 | 竖排宣纸首屏、示例作品横滑、三步流程、注册入口 |
| 创作台 | 意境输入（120 字 + 快捷示例）、体裁（五/七言）、风格（婉约/豪放/冲淡/绮丽/雄浑）、格律档位（严格/宽松） |
| 三段式生成 → **四段式** | ① **意境润色**：把你的原话扩写成一份可编辑的意境稿（可改、可删意象、可重写），确认后才往下走 ② 依律成诗（成诗请求**带着稿子原文**）③ 程序校验 ④ 不合格时**只重写坏句** → 仍不合格才用本地诗句补那一句 → 坏句过半才整首回落 |
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
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | **通用 OpenAI 兼容通道（推荐）**，如 DeepSeek：`https://api.deepseek.com/v1` + `deepseek-chat` |
| `MODELSCOPE_API_KEY` | 魔搭 ModelScope 通道（模型会上下架，`MODELSCOPE_MODEL` 可填多个候选） |
| `SENSENOVA_API_KEY` | 商汤日日新备用通道（单 Key，直接作为 Bearer） |
| `SENSENOVA_AK` / `SENSENOVA_SK` | 商汤日日新备用通道（AK/SK 换 JWT，与单 Key 二选一） |
| `JWT_SECRET` | 会话签名密钥，生产必须替换 |
| `ADMIN_USERNAME` | 管理员用户名 |
| `PBKDF2_ITERATIONS` | 密码迭代次数，免费实例可降到 20000 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | 配置后注册/生成需通过人机验证 |
| `PORT` | 固定端口，默认随机 |

Key 只存在于服务端环境变量，前端代码中不出现任何密钥。

## 提示词与参数

四段提示词都在 `shared/prompts.js`（服务端与 Edge 共用同一份，别在 `server/` 和 `functions/` 各抄一份）：

| 阶段 | 常量 | temperature | top_p | max_tokens | 单步超时 |
| --- | --- | --- | --- | --- | --- |
| ① 意境润色 | `THEME_SYSTEM` | 0.7 | 0.9 | 700 | 18s |
| ② 意象解析（旧接口） | `IMAGERY_SYSTEM` | 0.3 | 0.8 | 400 | 默认 |
| ③ 格律成诗 | `POEM_SYSTEM` | 0.85 | 0.9 | 500 | 70s |
| ④ 逐句校对 | `FIX_SYSTEM` | 0.25 → 0.15 | 0.7 | 400 | 18s |

降级链：魔搭 → 商汤 → 本地演示库。生成结果按 `sha256(意象+意境稿+体裁+风格+档位)` 缓存 24 小时；「换一首」携带 avoid 参数绕过缓存。

**只有「模型写成 + 校验通过」的结果才进缓存** —— 缓存降级结果等于把一次偶发失败钉死 24 小时，用户怎么刷新都是同一首库存。

不合律时的兜底顺序（不能颠倒）：

1. **逐句诊断重写**：只把坏句连同「第几句字数不对 / 第几句出韵」喂回去，好句**强制还原**（模型很爱顺手润色没让它动的地方）
2. 再来一轮（降温度）
3. **库存补坏句**：只补不承担押韵的位置（第 3 句通常可补；第 2、4 句必须押韵，绝不动）
4. **整首回落**：坏句过半才做，且前端会写明"整首改用本地诗库"

## 回归

```bash
npm run test:pipeline    # 35 项，零外网零额度（桩件替换 fetch，真起服务真打接口）
```

覆盖：成诗请求是否真的带着意境稿、坏句重写是否只改坏句、库存补句是否保住其余三句、上游全挂时是否降级、模型回「抱歉我无法完成」是否被识别。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/theme` | ① 意境润色，返回可编辑的意境稿（需登录） |
| POST | `/api/imagery` | 意象解析（旧接口，保留兼容；新前端不再调用） |
| POST | `/api/poem` | ② 成诗 + ③ 校验 + ④ 兜底（需登录；建议带上 `theme`） |
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
│  ├─ app.html              创作台（含意境稿环节）
│  ├─ login.html  register.html  admin.html
│  ├─ blog.html  post.html            诗话列表 / 文章详情
│  ├─ admin-posts.html  admin-editor.html  文章管理 / 编辑器
│  ├─ favicon.ico  manifest.webmanifest
│  └─ assets/css|js|img
├─ shared/
│  └─ prompts.js            四段提示词 + JSON 解析（服务端与 Edge 共用）
├─ server/
│  ├─ index.js              HTTP 服务与路由
│  ├─ model.js              模型双通道适配（Node 版）
│  ├─ poems.js              演示诗词库、本地润色、成诗、校验、坏句替换
│  └─ store.js              JSON 存储、PBKDF2、会话、缓存、频控
├─ functions/               Cloudflare Pages Functions（线上入口）
│  ├─ api/[[path]].js       与 server/index.js 同一套流水线
│  └─ lib/                  模型适配（Edge 版）、鉴权、存储
├─ scripts/
│  ├─ build.mjs             把 public/ 输出到 dist/
│  └─ test-pipeline.mjs     流水线回归（桩件，零外网）
├─ data/db.json             本地用户库（首次启动自动生成）
└─ schema.sql               Cloudflare D1 建表脚本
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
