# 就背单词

一个以临考速刷和间隔复习为核心的单词学习网站。React / Node.js 工具链 + Go API + SQLite。

前端使用 HeroUI v3、HeroUI Pro、Tailwind CSS v4 与 shadcn Command / Dialog 辅助控件。Go 同时提供 API 和构建后的网页，部署时只需要一个容器。

## 功能

- 词书选择、双向选择题学习、到期复习、收藏和个人学习统计。常规学习、复习与巩固交替使用英译中 / 中译英题，答后展示释义与例句；想不起来可以直接查看答案，按未记住处理。错词在本轮末再练一次，纠错练习不重复计数或改变首次答题的复习安排。干扰项来自当前词书，选项不足时使用实际数量，只有一个可区分词时改为拼写题。
- 答后集中阅读正确答案与语境，例句突出目标词，支持收藏；本题选项可展开查看。手机底部保留下一题，首次练习与错词回练分别显示进度，完成后可回顾本轮错词。
- 首页优先呈现到期复习，其后按实际未学数量提供新词入口。词书支持分类、搜索和未学 / 学习中 / 已掌握 / 待巩固筛选；从详情页开始练习时同步设为当前词书。
- 临考速刷：直接选择“会”标记为已掌握；“不会”保留原状态；“不确定”先显示释义，之后选“会”进入巩固列表，选“不会”保留在未掌握范围。
- 间隔复习：按答题表现安排后续复习，遗忘后进入短间隔重学。
- 学习快捷键：`1–4` 选答案、`Enter` 继续、`F` 发音；中译英题答前隐藏发音，避免泄露答案。速刷使用 `1 / 2 / 3` 判断、空格查看释义、`F` 发音，空格不再兼任发音。
- 游客独立进度；注册可保留当前游客记录；账号登录后跨浏览器使用。
- 管理后台：真实站点统计、词书与词条管理、JSON 批量导入、用户列表、可保存的导航顺序/名称/显示配置。

内置词书是少量原创双语例句的**精选样本**，不是完整考试大纲词库。可通过后台导入自己的完整词库。每日统计以 UTC 日期计数。发音使用有道音频接口 `https://dict.youdao.com/dictvoice?type=<type>&audio=<word>`，美式为 `type=0`，英式为 `type=1`，单词通过 URL 参数编码后请求；需要能够连接有道服务。

学习流程的产品参考与取舍见 [学习体验设计](docs/learning-experience.md)。

最新发布：[v0.1.0 交付记录](docs/releases/v0.1.0.md)，包含镜像 digest、验证范围和流水线状态。

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

向已合入 `main` 的提交推送新的 `vX.Y.Z` 标签，将执行完整后端验证并发布 `ghcr.io/koinaai/word:vX.Y.Z`。流水线优先拉取已发布的 `sha-<完整提交 SHA>` 候选镜像，检查 `linux/amd64` 平台、源码仓库及提交标签，再运行容器检查并给同一份镜像添加版本标签。没有候选镜像时，使用仓库 Actions secret `HEROUI_AUTH_TOKEN` 从源码构建；两者都不存在则明确失败。

本机持有授权缓存时，在推送版本标签之前，先从已合入 `main` 的确切提交构建并发布 SHA 候选：

```sh
revision=$(git rev-parse HEAD)
version=v0.1.0
image="ghcr.io/koinaai/word:sha-$revision"
docker build --platform linux/amd64 \
  --secret id=heroui_package,src=.secrets/heroui-pro.tgz \
  --build-arg VCS_REF="$revision" --build-arg VERSION="$version" -t "$image" .
python3 scripts/verify_image.py "$image" "$revision"
python3 scripts/smoke_container.py "$image"
# 使用有 package 写权限的账号登录后，确认 SHA 标签尚不存在，再推送。
docker push "$image"
git tag -a "$version" -m "$version"
git push origin "$version"
```

发布流水线只接受当前提交对应的候选镜像，不重建或覆盖已有 SHA 镜像。版本镜像发布后会按 registry digest 回拉，确认镜像 ID 与已测试候选一致，再验证运行。GHCR 包需要授予本仓库的 Actions 访问权限。

如果发布在部分标签已推送后中断，直接重跑会因标签已存在而停止。先核对已发布镜像的 digest、源码提交标签和验证结果，再从该 digest 恢复缺失的标签或使用新版本修复；不要移动版本标签或覆盖旧镜像。

GHCR 新包可能默认私有；发布成功不等于匿名可拉取。包的可见性和读取权限由仓库管理员按部署需要设置。部署及回滚建议固定 digest。
