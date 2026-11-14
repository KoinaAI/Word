# 就背单词

一个可直接部署的单词学习网站：React + Node.js 工具链，Go API，SQLite 持久化。前端采用 HeroUI 3、HeroUI Pro、Tailwind CSS 4、shadcn Command、Motion 和 Sonner。

## 功能

- **词书库**：分类、搜索、词书详情、设置当前词书，内置 6 本各 20 词的精选示例（不是完整考试词库），可从后台导入自己的完整词书。
- **常规学习与复习**：记住后按 1 / 3 / 7 天及后续 ease 倍率安排复习；忘记后 10 分钟重学。不同账户的进度独立。
- **临考速刷**：初始只展示单词、音标和发音，底部提供“不会 / 不确定 / 会”。会则标记已学；不会保留原状态；不确定先展示释义，随后会则进入巩固列表，不会保留待学。每轮结束显示本轮结果。
- **巩固、收藏与记录**：独立巩固队列、语音朗读、键盘快捷键、每日目标、考试日期、真实学习统计和深浅色主题。
- **账户**：无需注册即可建立访客会话；注册时保留当前访客进度；邮箱密码登录；管理员与普通用户权限隔离。
- **动态后台**：站点数据、词书增删改、词条管理、原子 JSON 批量导入、用户列表，以及持久化的导航名称、顺序和启用开关。配置变更立即更新当前页面，其余管理会话每 30 秒同步。

## Docker 运行

镜像地址：`ghcr.io/koinaai/word:0.1.0`。首次发布的 GHCR 包默认私有，如需拉取，先使用具备 `read:packages` 权限的账户执行 `docker login ghcr.io`。镜像发布工作流验证 Linux amd64；Apple Silicon 可通过 Docker 的 amd64 模拟运行。

```bash
cp .env.example .env
# 编辑 .env，设置随机 ADMIN_PASSWORD（10–72 字节）
docker compose up -d
```

打开 <http://localhost:8080>。管理员从登录页使用 `.env` 中的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录。首次启动初始化管理员，已有数据库启动时不会重置密码。

默认仅绑定 `127.0.0.1`。对外部署可设置 `BIND_ADDRESS=0.0.0.0`，在 HTTPS 反向代理后设置 `COOKIE_SECURE=true`。数据保存在命名卷 `word_word-data`。`docker compose down` 保留数据，**不要使用 `down -v`，除非确实要删除所有数据**。

```bash
docker compose logs -f
docker compose pull && docker compose up -d
```

生产部署建议把 `WORD_IMAGE` 设为发布时返回的 `ghcr.io/koinaai/word@sha256:...`，以固定具体版本。

## 从源码开发

需要 Node.js 24.22.3+、Go 1.26.7，以及 HeroUI Pro 授权。Pro 包的 npm 发布物是安装引导程序，真实组件需要授权安装；仓库不包含 Pro 源码或凭据。

```bash
cd web
npm ci
npm run dev
```

`npm ci` 的项目脚本会优先使用 `~/.heroui/cache/react/1.0.0-beta.11` 或 `HEROUI_PRO_DIR` 指定的已授权包目录。没有缓存时，可设置官方 `HEROUI_AUTH_TOKEN`，或先执行 `npm ci --ignore-scripts`、`npx heroui-pro login`、`npx heroui-pro install react`。CollectUI 授权用户可按供应商说明使用 `HEROUI_KEY` 与 `hpsetup@4.8.0`；该安装器要求项目路径不包含中文或空格。

另一个终端：

```bash
cd backend
ADMIN_PASSWORD='your-long-random-password' DEV_ORIGIN=http://localhost:5173 go run ./cmd/server
```

打开 <http://localhost:5173>。Vite 将 `/api` 代理到 Go 的 8080 端口。发音使用浏览器 SpeechSynthesis，声音取决于设备已安装的英语语音。

## 本地构建镜像

将你已授权的 HeroUI Pro 包打包，作为 BuildKit secret 使用（不会进入最终运行镜像）：

```bash
tar -czf /tmp/heroui-pro.tgz -C "$HOME/.heroui/cache/react/1.0.0-beta.11" .
HEROUI_PRO_ARCHIVE=/tmp/heroui-pro.tgz \
  docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

也可以直接使用官方 CI token：

```bash
docker build --secret id=heroui_auth_token,env=HEROUI_AUTH_TOKEN -t word:local .
```

最终镜像只包含 Go 可执行文件与前端构建产物，以 UID 10001 运行，提供健康检查和优雅停止。Compose 启用只读根文件系统、独立数据卷以及最小容器权限。

## 词库导入

后台“词书管理 → 管理词条 → 导入 JSON”支持数组或 `{ "words": [...] }`，每次最多 5000 条、文件最大 5 MB。相同词书内按 `text` 更新已有词条，校验失败会整批回滚。

```json
[
  {
    "text": "serendipity",
    "phonetic": "/ˌserənˈdɪpəti/",
    "meaning": "n. 意外的幸运",
    "example": "Finding this book was pure serendipity.",
    "exampleMeaning": "找到这本书纯属意外之喜。"
  }
]
```

仅 `text` 与 `meaning` 必填。请自行确认导入内容的使用权。

## 验证与发布

日常提交只运行相关模块检查。新增 `vX.Y.Z` 标签触发发布验证、Docker 构建、核心学习流程检查，随后将**同一已测试镜像**推送 GHCR，并按摘要重新拉取验证。

```bash
cd backend && go test ./internal/app
npm run build --prefix web # 在仓库根目录执行
python3 scripts/container-smoke.py http://localhost:8080
```

最后一条会创建独立访客并写入三条学习记录，仅用于测试实例。CI 需要仓库 secret `HEROUI_KEY`（CollectUI 安装凭据）；PR 来自外部 fork 时不提供授权 secret，只检查依赖安装，完整授权构建在可信分支执行。

项目契约见 [docs/api.md](docs/api.md)。统计按 UTC 日期归档。复习采用透明的 SM-2 风格间隔规则，不承诺精确拟合每个人的遗忘曲线。
