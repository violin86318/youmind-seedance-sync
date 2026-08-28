# Seedance Prompt Sync

独立的 Seedance 提示词同步与检索站点工程。项目代码为独立实现，不隶属于 YouMind。

这个项目把 `https://youmind.com/zh-CN/seedance-2-0-prompts` 上的 Seedance 2.0 提示词做成三件事：

1. 抓取 YouMind 公开分页接口，保存为本地 JSON。
2. 同步到飞书多维表格。
3. 先把飞书多维表格当成站点构建源，再生成一个可部署的轻量站点。

## 许可与来源

- 本仓库**自有代码**（同步脚本、站点构建、前端、Workers）采用 [MIT License](./LICENSE)。
- 本仓库引用或改编的 **YouMind OpenLab 提示词内容/元数据**，其上游来源为：
  - `https://youmind.com/zh-CN/seedance-2-0-prompts`
  - `https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts`
- 上游公开提示词库当前发布的许可为 **CC BY 4.0**。二次分发或改编这些内容时，应：
  - 标注来源与作者信息
  - 链接原许可
  - 明示改动
  - 不暗示 YouMind 对本项目的认可或背书

边界说明：

- 本项目不是 YouMind 官方产品，也不应复刻其商标、Logo、站点文案或整体 look and feel。
- 本仓库的 MIT 许可**不覆盖**第三方内容、商标和站点外观设计。
- 更完整的第三方说明见 [NOTICE](./NOTICE)。

## 当前方案

- 数据源：直接使用 YouMind 前端的公开接口 `/youhome-api/video-prompts`
- 飞书建表：本地通过 `lark-cli` 完成
- GitHub 自动同步：优先支持自托管 Runner 直接复用本机 `lark-cli`，也兼容用 Open API 同步
- 类似网站：`site/` 目录是纯静态前端，GitHub Pages 可直接部署
- 站点构建：优先从飞书多维表格回读数据并校验；如果飞书异常，再回退到 YouMind 快照 / 公开接口
- 自托管 Runner 会把提示词快照持久化到本机缓存目录，避免频繁全量抓取导致 YouMind `429 Too Many Requests`

## 为什么不是直接监听上游仓库 push

上游仓库 `YouMind-OpenLab/awesome-seedance-2-prompts` 是外部仓库，GitHub Actions 不能直接对“别人的仓库 push”原生触发。这里采用的是更稳妥的轮询方式：

- 每小时拉一次 YouMind 最新公开数据
- 只对新增 / 变更 / 下线记录做增量同步

这个效果上等价于“上游更新后不久自动同步”。

## 本地命令

```bash
npm run fetch
npm run sync:lark
npm run build:site
```

如果你想让脚本先自动刷新本机 `lark-cli` 登录态，再执行同步：

```bash
npm run sync:lark:local-auth
```

如果你想在本机装 GitHub Actions self-hosted runner：

```bash
npm run setup:runner
```

如果你要重新新建一套飞书多维表格：

```bash
npm run bootstrap:lark
```

运行后会生成本地文件 `.seedance.local.json`，里面保存当前 Base Token / Table ID。这个文件已经被 `.gitignore` 忽略。

## GitHub Actions 同步方式

### 方案 A：自托管 Runner + 本机 `lark-cli`（不需要 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`）

这是最贴近你当前用法的方案。要求：

- 你的机器注册成 GitHub Actions 的 `self-hosted` runner
- 这台机器上 `lark-cli auth status` 已经是登录成功状态
- 本机存在 `~/.lark-cli/refresh-token.py`
- 仓库 Variables 里设置 `ENABLE_SELF_HOSTED_LARK_SYNC=1`
- 本机 runner 带有 `youmind-sync` label
- macOS self-hosted runner 需要可用的 `gtar`，`npm run setup:runner` 现在会自动通过 Homebrew 安装 `gnu-tar`

工作流会在 self-hosted job 里直接执行：

- `npm run sync:lark:local-auth`

如果你还要让同一个 self-hosted workflow 自动部署 Cloudflare Pages，还需要在仓库 Secrets 里配置：

- `CLOUDFLARE_API_TOKEN`

这个脚本会先尝试刷新本机 `lark-cli` token，再用 `lark-cli` 直接同步飞书。

另外，自托管工作流会设置：

- `YOUMIND_CACHE_DIR=$HOME/.cache/youmind-seedance-sync`
- `YOUMIND_MAX_CACHE_AGE_HOURS=12`
- `YOUMIND_ALLOW_STALE_CACHE_ON_ERROR=1`

效果是：

- 12 小时内已有成功快照时，优先直接复用缓存
- 缓存过期后会再尝试抓远端
- 如果远端因为限流失败，但本机还有旧快照，工作流会自动回退到旧快照继续同步和部署
- 定时任务现在改成每天一次（GitHub Actions 的 `0 0 * * *`，即北京时间每天 `08:00`）
- 定时任务会先比较 prompt 快照签名；如果内容没变，就直接跳过飞书同步、R2 镜像、站点构建和部署
- 定时任务如果生成出的 `site/data/prompts.json` 没变化，会直接跳过 Pages 部署，避免重复上传同一份站点
- 如果没有配置 `CLOUDFLARE_API_TOKEN`，workflow 会跳过 Cloudflare Pages 部署，但仍继续 GitHub Pages 部署

### 方案 B：GitHub 托管 Runner + Open API

如果你不用 self-hosted runner，而是直接跑 GitHub 托管 Runner，那还是需要在仓库 Secrets 里配置：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BASE_TOKEN`
- `FEISHU_TABLE_ID`

说明：

- `FEISHU_BASE_TOKEN` 和 `FEISHU_TABLE_ID` 可以从本地 `.seedance.local.json` 里取
- 这个模式对应工作流里的 `npm run sync:api`
- 只有 GitHub 托管环境才需要这一套，因为它无法直接复用你电脑上的 `lark-cli` 登录态

## 站点构建

先抓数据，再同步飞书，再生成站点数据：

```bash
npm run fetch
npm run sync:lark
npm run build:site
```

`npm run build:site` 的默认行为是：

- 本地 / self-hosted 有可用飞书表格时，优先从飞书回读记录生成 `site/data/prompts.json`
- 同时用刚抓下来的 YouMind 快照校验 `Prompt ID + Content Hash`
- 如果飞书读取失败、数据缺失或校验不通过，就自动回退到 YouMind 快照

生成后的静态数据文件在：

- `site/data/prompts.json`

站点入口：

- `site/index.html`

GitHub Actions 已经配置为自动部署到 GitHub Pages。

站点详情弹窗现在会优先播放 R2 镜像视频；如果某条记录没有视频，再回退到缩略图。

## R2 视频防盗链

R2 镜像视频不要长期使用公开 `r2.dev` 域名直出。项目里提供了一个 Worker 网关：

```bash
npm run deploy:video-gate
```

默认配置在 `workers/r2-video-gate/wrangler.toml`：

- R2 bucket：`violin86318-youmind-seedance-videos`
- 允许线上站点：`https://violin86318.github.io`、`https://seedance.beyondmotion.net`
- 允许本地预览：`http://localhost:*` / `http://127.0.0.1:*`
- 拒绝没有 `Origin` / `Referer` 的直接访问
- 只允许访问 `videos/` 前缀下的对象

部署后，把站点使用的视频前缀切到 Worker 域名：

```bash
YOUMIND_R2_PUBLIC_URL_BASE=https://youmind-r2-video-gate.<你的-workers-subdomain>.workers.dev npm run set:r2-public-url
YOUMIND_R2_PUBLIC_URL_BASE=https://youmind-r2-video-gate.<你的-workers-subdomain>.workers.dev npm run rewrite:r2-urls
YOUMIND_R2_PUBLIC_URL_BASE=https://youmind-r2-video-gate.<你的-workers-subdomain>.workers.dev npm run build:site
```

GitHub Actions 里也要把仓库 Variable `YOUMIND_R2_PUBLIC_URL_BASE` 改成同一个 Worker URL。确认站点已经使用 Worker URL 后，再关闭公开 `r2.dev`：

```bash
npm run disable:r2-dev-url
```

如果站点部署到自己的 Cloudflare 域名，可以把 Worker 绑定到独立媒体域名，例如 `media.example.com`，再把 `YOUMIND_R2_PUBLIC_URL_BASE` 改成这个域名。与此同时，需要把实际站点来源加入 Worker 的 `ALLOWED_ORIGINS`，例如 `https://example.com,https://www.example.com,https://violin86318.github.io`。这样 R2 bucket 可以保持私有，公开视频入口只剩 Worker。

## 自定义站点域名

当前线上站点域名是：

- `https://seedance.beyondmotion.net`

部署链路是：

- GitHub Actions 生成 `site/` 静态文件
- `site/data/prompts.json` 上传到 R2 桶 `seedance-data`（绕过 Pages 单文件 25 MiB 限制）
- 静态资源部署到 Cloudflare Pages 项目 `seedance-site`
- `seedance-site` Worker 绑定 `seedance.beyondmotion.net`：静态资源转发到 Pages 源站，`/data/prompts.json` 直接从 R2 读取
- R2 视频仍通过 `youmind-r2-video-gate` Worker 做来源校验

手动部署站点 Worker：

```bash
npm run deploy:seedance-site
```

手动上传站点数据到 R2：

```bash
CLOUDFLARE_API_TOKEN=<token> npx wrangler r2 object put "seedance-data/data/prompts.json" --remote --file site/data/prompts.json --content-type "application/json"
```

## 数据表字段

主表 `Prompts` 使用这些字段：

- `Prompt ID`
- `Title`
- `Description`
- `Prompt`
- `Translated Prompt`
- `Language`
- `Featured`
- `Active`
- `Source Link`
- `Source Published At`
- `Author`
- `Author Link`
- `Video URL`
- `Thumbnail URL`
- `Reference Images`
- `Detail URL`
- `Model`
- `Content Hash`
- `Synced At`

其中：

- `Content Hash` 用来判断内容是否变化，避免每次全表重写
- `Active` 用来标记源站已经下线或移除的提示词
