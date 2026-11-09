# 诗境 · 以君之意，成君之诗

移动端优先的古诗生成应用：用户写下一段意境描述，应用先解析意象，再依体裁与格律成诗，最后由程序逐字校验。设计依据 `古诗生成提示词设计方案 v2.0`。

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
| `SENSENOVA_AK` / `SENSENOVA_SK` | 商汤日日新备用通道（HMAC-SHA256 签 JWT） |
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

当前版本是可运行于本机的 Node 实现，数据库为 JSON 文件。迁移到 Pages Functions 时：

1. `wrangler.toml` 绑定 D1（`DB`）与 KV（缓存），执行 `schema.sql` 建表；
2. 把 `server/index.js` 的路由改写为 `functions/api/*.js`，`store.js` 的读写换成 D1 语句（表结构已对齐）；
3. 密钥全部用 `wrangler pages secret put` 注入：`MODELSCOPE_API_KEY`、`SENSENOVA_AK`、`SENSENOVA_SK`、`TURNSTILE_SECRET`、`JWT_SECRET`；
4. `public/` 作为构建输出目录，无需构建命令；
5. 绑定自定义域名后开启 Cloudflare Managed Challenge，实现"访问域名先人机验证"。

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
