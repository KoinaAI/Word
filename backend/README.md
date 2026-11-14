# Go 后端

标准库 HTTP、modernc SQLite、bcrypt；接口遵循 [`../docs/api.md`](../docs/api.md)。使用 Go 1.26.7 或更新的受支持版本。

在 `backend/` 中运行：

```sh
go build -o word-server ./cmd/server
# 首次运行前，通过环境或秘密管理器提供 ADMIN_PASSWORD（至少 10 字符，最多 72 字节）。
./word-server
```

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| `PORT` | `8080` |
| `DB_PATH` | `data/word.db`，持久数据库文件路径 |
| `ADMIN_EMAIL` | `admin@word.local`，首次初始化管理员邮箱 |
| `ADMIN_PASSWORD` | 首次初始化必填，至少 10 字符、最多 72 字节；不保存明文、不提供固定密码 |
| `COOKIE_SECURE` | `false`；HTTPS 部署设为 `true` |
| `DEV_ORIGIN` | 默认关闭；开发时可设 `http://localhost:5173`（也支持同端口回环 IP），只能与 `COOKIE_SECURE=false` 配合 |
| `WEB_DIR` | 可选，前端构建目录；不存在的无扩展名页面路径回退到 `index.html` |

已有管理员时，重启不要求再次提供密码；修改环境密码不会隐式重置已有账户。普通注册密码至少 8 字符、最多 72 字节。访客注册保留 ID、设置、进度、收藏和答题历史。会话随机生成、数据库仅保存令牌摘要，期限 30 天；注销撤销当前会话。鉴权入口按直连 IP 限制为每分钟 20 次，不信任客户端传入的代理 IP 头。

所有学习及管理接口都要求会话；管理接口还要求 `admin` 角色。修改请求带 `Origin` 时必须与外部请求的 host/协议一致，或命中显式开发源。无 `Origin` 的 CLI 请求可用，标记为跨站的浏览器请求被拒绝。反向代理应保留外部 Host，HTTPS 部署使用 Secure cookie。

学习状态及队列：

| 模式 / 答案 | 状态变化 |
| --- | --- |
| 任意模式 `known` | `mastered`，清除巩固标记，按连续次数安排 1 / 3 / 7 天，之后按 ease 倍增，最长 365 天 |
| 任意模式 `unsure-known` | `learning`，加入巩固队列，连续次数重置，一天后复习 |
| `sprint` 的 `unknown` / `unsure-unknown` | 原状态、巩固标记、复习日期、连续次数全部保留；未掌握词继续留在速刷队列 |
| 其他模式 `unknown` / `unsure-unknown` | `learning`，10 分钟后重学，连续次数重置；已有巩固标记保留，巩固模式下继续留队 |

`learn` 返回新词及到期的学习中词，排除巩固词；`review` 返回到期词；`sprint` 返回尚未掌握且不在巩固队列中的词；`reinforce` 返回已标记巩固的词。答题、状态更新及用户内唯一 `eventId` 在同一事务提交。相同事件重试成功且只计一次，不同请求复用同一 ID 返回 409。

`learned` / `learnedCount` 只统计 `mastered`。`today`、活动曲线与管理员 `answers` 统计实际提交的答题事件，包含不认识的回答；不把它们当作掌握数。活动曲线覆盖最近 30 个 UTC 日期，无事件日期为零；连续天数从今天（或尚未答题时的昨天）向前计算。最近 20 条历史保留作答时的词义，删除词条后历史仍在。管理员 `activeToday` 是当天实际答题的去重用户数。

首次初始化写入 6 本各 20 词的「精选」样本及原创双语例句。词书和导航只初始化一次，管理员删除或配置后重启不会被覆盖。导入验证整个批次，最多 5000 条；同一词书内不区分 ASCII 大小写的同词 upsert 保留词 ID 和所有用户进度，批内重复词会被拒绝。删除词书/词条级联清除进度，历史事件保留；删除当前词书后 `activeBookId` 返回 `0`，用户可重新选择。导航仅允许契约中的 4 个后台路径，导航管理模块必须保留并启用。

`/api/health` 与 `/health` 检查数据库连接。SIGINT / SIGTERM 最多等待 10 秒处理在途 HTTP 请求，再关闭 SQLite。数据库启用 WAL、外键与 busy timeout；单连接串行化事务，适用于此 SQLite 服务。备份运行中的数据库应使用 SQLite 在线备份，或先正常停止服务再复制数据库；容器数据必须持久化。

容器在 `backend/` 构建：

```sh
docker build -t word-backend:local .
docker run --rm -p 8080:8080 -e ADMIN_PASSWORD -v word-data:/app/data word-backend:local
```

镜像以 UID/GID 10001 运行；绑定宿主目录时先配置写权限。可挂载前端目录到 `/app/web:ro` 并设置 `WEB_DIR=/app/web`。

相关验证（不运行前端或仓库全量检查）：

```sh
go test -race ./internal/app -run 'Test(Auth|Origin|AdminInitialization|AnswerStateMachine|StudyIsolation|StatsUTC|AdminCRUD|Navigation|HTTPServing)' -count=1
go build -o word-server ./cmd/server
```
