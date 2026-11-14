# 就背单词

一个以临考速刷和间隔复习为核心的单词学习网站。React / Node.js 工具链 + Go API + SQLite。

前端使用 HeroUI v3、HeroUI Pro、Tailwind CSS v4 与 shadcn 风格的辅助控件。Go 同时提供 API 和构建后的网页，部署时只需要一个容器。

## 功能

- 词书选择、常规学习、到期复习、收藏和个人学习统计。
- 临考速刷：直接选择“会”标记为已掌握；“不会”保留原状态；“不确定”先显示释义，之后选“会”进入巩固列表，选“不会”保留在未掌握范围。
- 间隔复习：按答题表现安排后续复习，遗忘后进入短间隔重学。
- 游客独立进度；注册可保留当前游客记录；账号登录后跨浏览器使用。
- 管理后台：真实站点统计、词书与词条管理、JSON 批量导入、用户列表、可保存的导航顺序/名称/显示配置。

内置词书是少量原创双语例句的**精选样本**，不是完整考试大纲词库。可通过后台导入自己的完整词库。每日统计以 UTC 日期计数。发音使用浏览器提供的语音能力，音色及可用性取决于设备。

## Docker Compose

先准备环境配置：

```sh
cp .env.example .env
# 编辑 .env，将 ADMIN_PASSWORD 设为自己的 12–72 字节密码。
```

使用发布镜像时，在 `.env` 设置发布记录中的不可变地址：

```dotenv
WORD_IMAGE=ghcr.io/koinaai/word@sha256:<发布记录中的 digest>
```

```sh
# 如果 GHCR 包尚未公开，先使用拥有该包读取权限的 GitHub 账号登录。
docker compose pull
docker compose up -d --no-build
```

打开 <http://localhost:8080>。管理员使用 `.env` 中的 `ADMIN_EMAIL`、`ADMIN_PASSWORD` 登录，再进入 `/admin`。密码只用于首次初始化；修改环境变量不会重置现有管理员密码。

SQLite 保存于 `word-data` 命名卷。`docker compose down` 保留学习数据；`docker compose down -v` 会删除数据。备份时先停止服务，再备份卷内的数据库文件。容器以 UID `10001` 运行，根文件系统只读，仅数据卷可写。

默认只监听本机 `127.0.0.1:8080`。公网部署使用 HTTPS 反向代理，转发原始 `Host`，并设置 `COOKIE_SECURE=true`。如需从外部代理访问，可调整 `BIND_ADDRESS`。反向代理和证书由部署环境提供。

## 从源码构建

需要 Node.js 24+、Go 1.26+。HeroUI Pro 是商业依赖，公共 npm 包仅是安装入口，**源码构建需要有效的 HeroUI Pro 授权**。本仓库不包含其完整组件库或授权凭据。

有 HeroUI CI/CD token 时：

```sh
cd web
# 将 HeroUI 控制台生成的 token 作为环境变量注入，不要提交到仓库。
HEROUI_AUTH_TOKEN="..." npm ci
npm run dev
```

已有本机授权缓存时，先正常安装依赖，再将同版本的 Pro 包用于构建。Docker 支持将完整的授权包作为 BuildKit secret 传入：

```sh
python3 scripts/prepare_pro_archive.py ~/.heroui/cache/react/1.0.0-beta.11
docker compose up -d --build
```

脚本生成的 `.secrets/heroui-pro.tgz` 仅用于本地构建，不得提交或公开分发。Docker 构建会检查其版本是否与锁文件一致；最终镜像只包含应用构建产物。

也可直接用 token 构建，不需要本地包：

```sh
# HEROUI_AUTH_TOKEN 应已由 shell 或 CI 的秘密管理功能注入。
docker build --secret id=heroui_token,env=HEROUI_AUTH_TOKEN -t word:local .
docker compose up -d --no-build
```

启动开发 API：

```sh
cd backend
ADMIN_PASSWORD="自己设置的管理员密码" DEV_ORIGIN=http://localhost:5173 go run ./cmd/server
```

前端开发服务器将 `/api` 转发到本机 `8080`，后端默认数据库路径为 `backend/data/word.db`。API 字段及状态流转见 [docs/api.md](docs/api.md)。

## 导入词条

在管理后台创建词书，再向其中导入 JSON。一次最多 5000 个词条，同一本书内相同单词会更新，整批验证失败则不写入。

```json
{
  "words": [
    {
      "text": "persist",
      "phonetic": "/pəˈsɪst/",
      "meaning": "v. 坚持；持续存在",
      "example": "Small habits persist when they fit your day.",
      "exampleMeaning": "当小习惯适合日常节奏时，它们就能持续下去。"
    }
  ]
}
```

## 检查与镜像发布

日常检查按变更目录运行：前端 `npm run build`，后端 `go test ./internal/app` 和 `go build ./cmd/server`；容器配置变更才增加镜像启动、持久化与退出检查。

```sh
python3 scripts/smoke_container.py word:local
```

GitHub Actions 的 `Scoped checks` 记录实际验证范围。只有可信分支推送能使用 `HEROUI_AUTH_TOKEN`；未配置 token 或 PR 环境中，前端/容器任务明确标记为跳过，不能把该运行当作完整前端构建证据。合并前应补充授权的本地构建结果。

配置仓库 Actions secret `HEROUI_AUTH_TOKEN` 后，向已合入 `main` 的提交推送新的 `vX.Y.Z` 标签，将执行版本验证并发布 `ghcr.io/koinaai/word:vX.Y.Z` 和 `sha-<完整提交 SHA>`。流水线先验证构建出的 `linux/amd64` 镜像，再推送同一镜像并按 digest 回拉检查，不覆盖已有版本标签。未配置 token 时自动发布会明确失败；本机可使用授权缓存构建、验证，再发布该镜像。

GHCR 新包可能默认私有；发布成功不等于匿名可拉取。包的可见性和读取权限由仓库管理员按部署需要设置。部署及回滚建议固定 digest。
