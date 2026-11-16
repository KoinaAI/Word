# API contract

所有接口位于 `/api`，使用 camelCase JSON。成功直接返回对象；错误通常为 `{error:string}`，身份冲突另带 `code`，导入校验另带坏项位置。写入使用 `Content-Type: application/json`，拒绝未知字段、多个 JSON 对象和超过 8 MiB 的请求体。时间为 ISO 8601 UTC，按日统计为 `YYYY-MM-DD` UTC。

## 身份与会话

- `word_session` 为 HttpOnly、SameSite=Lax Cookie。未登录访问身份接口返回 401，非管理员访问后台返回 403。
- 浏览器读取身份后，写请求携带 `X-Word-User-ID: <页面用户 ID>`。它与 Cookie 身份不符、会话失效或值无效时，服务端在写入前返回 `409 {error,code:"SESSION_CHANGED"}`。该头是防止旧页面误写新账号的并发屏障，不能代替认证；无头请求保留按当前 Cookie 处理的兼容行为。
- 前端用 BroadcastChannel／storage 通知切账号，取消旧请求、清空身份缓存、向服务器核实身份并重挂载页面。广播不直接建立身份；旧身份请求的迟到响应不能填入新账号缓存。
- 会话初始有效期 30 天；服务端剩余不超过 7 天时，认证 API 活跃将同一 token 延至 30 天。普通 API 不回写 Cookie，避免迟到响应覆盖新账号 Cookie。只有 `GET /me` 带 `X-Word-Session-Renew: 1` 才同步浏览器 Cookie 的剩余有效期。
- 前端将 `/me` 与 `/auth/` 请求置于相同跨标签页排他范围，覆盖 fetch 和 JSON 读取完成后才释放；优先 Web Locks，无该能力时用 IndexedDB 同 store 的 readwrite 事务协调，因此普通 HTTP 局域网也可续期。只有取得协调锁才发送续期头，不在已失败的 Web Lock 后另开独立机制重复请求。
- Web Locks 与 IndexedDB 均不可用／禁用时，登录仍可用，前端不发送续期头；浏览器 Cookie 到原有效期仍会过期，不能承诺所有环境无限自动续期。清 Cookie、到期或换设备可能失去原访客入口，应注册保留可登录身份。
- 前端默认 15 秒确认超时，支持取消。写入超时／退出仅表示结果未确认，不能推断服务端未提交；答题必须按原 eventId 和参数重试。

| 方法与路径 | 请求 → 响应 |
| --- | --- |
| `POST /auth/guest` | 创建访客 → `User`（201）；已有身份则返回原 `User`（200），不切账号。 |
| `POST /auth/register` | `{name,email,password}` → `User`（201）。访客转换原身份并保留进度；正式账号须先退出（409）。昵称 1–40 个 Unicode 字符，密码 8–72 个 UTF-8 字节。 |
| `POST /auth/login` | `{email,password}` → `User`。邮箱统一小写并去首尾空白，凭据错误 401；表单不依赖创建访客。 |
| `POST /auth/logout` | 删除当前会话、清除 Cookie → `{ok:true}`。 |
| `GET /me` | → `User`。 |
| `PATCH /me` | `{dailyGoal?,examDate?,activeBookId?,name?}` → 当前 `User`。只更新提供的非 null 字段，未提供字段保留数据库当前值；同字段并发修改以最后成功写入为准。 |

`User = {id,name,email,role,guest:boolean,dailyGoal:number,examDate:string,activeBookId:number}`，role 为 `user` 或 `admin`。dailyGoal 是**每轮新词数量**，整数 1–500；examDate 是有效日期或空字符串；activeBookId 为 0 时取消当前词书，大于 0 时必须存在；昵称去首尾空白后 1–40 字。

访客创建、注册、登录共用按客户端地址计算的认证限流：每 5 分钟最多 30 次，超限返回 429 和 `Retry-After`。代理部署需配置 `TRUSTED_PROXIES`。

## 词书与列表分页

`Book = {id,title,subtitle,description,category,color,wordCount,learnedCount,dueCount,newCount,unstartedCount,learningCount,reinforceCount,sprintCount}`。公开接口计数按当前用户计算，匿名浏览没有个人进度。

| 计数 | 含义 |
| --- | --- |
| `wordCount`／`learnedCount`／`dueCount` | 全部词条／持久化为 mastered／复习时间已到期。 |
| `newCount` | status=new，包括 stage1；用于续学入口。 |
| `unstartedCount` | status=new 且 learnStage=0；对应“未学”。 |
| `learningCount` | status=learning，或 status=new 且 learnStage=1。 |
| `reinforceCount` | 独立待巩固标记，可以与学习中重叠。 |
| `sprintCount` | status!=mastered 且无待巩固标记，与实际队列一致。 |

`Word = {id,bookId,text,phonetic,meaning,example,exampleMeaning,favorite:boolean,favoriteRevision:number,status,reinforce:boolean,dueAt?:string,learnStage,learnRevision:number,contentVersion:number}`。status 为 `new/learning/mastered`，learnStage 为 0、1 或 2。

| 方法与路径 | 响应／参数 |
| --- | --- |
| `GET /books?q=&category=` | → `Book[]`。q 搜标题／介绍，category 精确匹配；去首尾空白后分别最多 200／80 UTF-8 字节。词书目录仍返回数组。 |
| `GET /books/{id}?offset=0&limit=50&q=&status=all` | → `{book,words,total,wordTotal,offset,limit,hasMore}`，按词 ID 升序。total 为筛选后数量，wordTotal 为同值兼容字段。 |
| `GET /favorites?paged=1&offset=0&limit=50&q=` | → `{items:Word[],total,offset,limit,hasMore}`。无 paged=1 时返回相同分页范围的 `Word[]`，不保证整份收藏。 |
| `GET /favorites/{wordId}` | → `{wordId,favorite:boolean,revision:number}`，同一快照读取收藏状态与持久化版本。 |
| `POST /favorites/{wordId}` | `{favorite:boolean,expectedRevision?:number}` → `{ok:true,favorite,revision}`。浏览器使用 expectedRevision 比较交换；旧版本 409 并返回 `{error,favorite,revision}`。 |

详情、收藏、后台用户默认 limit=50，允许整数 1–200；offset 为整数 0–10,000,000。格式错误或越界返回 400，不静默截断。q 搜英文／释义，最多 200 UTF-8 字节。详情 status 允许空值／all、new、learning、mastered、reinforce；new 对应 unstartedCount，learning 对应 learningCount。

前端词条、收藏和后台词条／用户每页 50 项。筛选变化回首屏，最后页删除／取消收藏导致空页时回到有效页；全书汇总来自 Book，不由当前页长度推算。

收藏 revision 在取消收藏后仍保留，每个成功写入（即便布尔值未变）都递增，以阻止旧在途请求在后来的取消后重新加回。省略 expectedRevision 兼容旧客户端，不提供并发保护；带版本重试旧请求可能 409，不能把整个响应称为幂等。浏览器按用户／词串行意图，提交前读取当前 revision，冲突或确认超时最多重新确认 3 次；切账号后不再发送旧身份排队操作。

## 学习批次

`GET /study?bookId=1&mode=learn&limit=100&after=0` → `{book,words,vocabulary,total,hasMore,nextAfter}`。mode 为 `learn/review/sprint/reinforce`。

- limit 默认 100、允许 1–200。learn 再取 min(limit,dailyGoal)，先返回 stage1 再按词 ID；每组从 after=0 重新读取未完成阶段，不用 ID 游标跳过续学词。
- review 取到期词，sprint 排除掌握／待巩固，reinforce 取待巩固。这三种按词 ID 升序；后续批次传 nextAfter，after 为非负整数。offset 不用于推进学习批次。
- total 是**资格条件及 after 过滤后的剩余词数**，随作答变化，不能作为整场固定分母。hasMore 表示本次还有未返回的词，nextAfter 是本批最大词 ID；空批次保留请求的 after。
- 非速刷另带最多 200 个轻量出题候选，使用 id/bookId/text/meaning/contentVersion 等字段，不含完整例句内容。速刷 vocabulary=[]。候选不是完整词书，不能用其长度统计词数。

## 作答、并发与撤销

`POST /study/answer {wordId,mode,answer,eventId,contentVersion?,learnStage?,learnRevision?}`。

- answer 为 `known/unknown/unsure-known/unsure-unknown`，unsure 仅用于 sprint。eventId 按用户唯一，8–128 字节，无首尾空白。
- 浏览器须传当前题目的正整数 contentVersion；兼容旧客户端时服务端允许省略。新事件版本不符返回 409。已确认事件的幂等重试返回原结果，不能用新事件盲目补发未知结果。
- learn 必须带当前 learnStage=0 或 1、learnRevision，其他模式禁止带。字段无效 400；阶段／内容／队列资格已变 409；词不存在 404。
- learn 返回 `{ok:true,learnStage,learnRevision,completed:boolean}`，其他模式 `{ok:true}`。learn 每次接受后 revision 递增；known 前进一阶段，unknown 回 stage0；两步完成前 status 仍为 new、不排复习，stage2 才掌握并排首次复习。
- 状态和历史在事务中保存。用原 eventId、word/mode/answer 和 learn 阶段参数重试返回原快照，包括后续又作答或删词后；改写这些参数复用 ID 返回 409。已撤销原事件不能重放恢复（409）。
- 其他模式实际改变记忆时重置 learn 阶段并递增 revision；sprint unknown／unsure-unknown 不改既有记忆与部分阶段。内容实质更新会使未完成阶段失效，见导入约定。

| 模式／评分 | 持久化结果 |
| --- | --- |
| sprint known | 直接掌握，安排间隔复习。 |
| sprint unknown／unsure-unknown | 记录判断但不改掌握／到期，仍可显式再刷。 |
| sprint unsure-known | 看过释义后会：learning + reinforce，约 1 天后到期。 |
| reinforce known／unknown | known 清巩固并掌握排复习；unknown 清巩固回新词。 |
| review unknown | learning，约 10 分钟后重学。 |

完成新词或其他 known 采用类似 SM-2 间隔：1、3、7 天，之后按 ease 延长、最多 365 天。单题答对不等于两阶段完成。

`POST /study/answer/undo {eventId}` → `{ok:true}`：

- 仅本人 sprint 事件，服务端按原事件保存时间限 120 秒。UI 只提供最近一次本地确认判断；后端要求该事件仍为该用户该词最新事件，当前 learn revision 与 contentVersion 均与快照相符。
- 超时、同词后续练习、内容更新、已删词返回 409；他人／不存在的可撤销事件 404。撤销恢复前状态与阶段，原无 progress 行则恢复其不存在；revision 单调递增，旧页面不能继续旧阶段。
- 历史保留 undone 标记，重复撤销幂等 200；原答题重发 409。撤销事件从作答数、活跃图、recent、连续天数、today 排除；掌握／到期／巩固按恢复后的 progress 计算。
- 撤销结果未知时暂停后续判断，用同事件重试确认或退出后确认，不能当成已撤销继续答题。

## 统计

- `GET /stats` → `{learned,due,reinforce,favorites,today,streak,totalWords,activity:[{date,count}],recent:[{id,text,meaning,answer,createdAt}]}`。
- `GET /admin/stats` → `{users,books,words,answers,activeToday,activity,recent}`。
- activity 为含今天的 14 个 UTC 日期、空日补 0；recent 最多 10 条。每个接受的新词阶段为真实作答，activity 算尝试次数，today 按当日所有模式 submitted_word_id 去重；同词反复练只算一个词，undone 全部排除。
- 掌握词数来自 progress；recent 的 known 不能推算两阶段完成。个人查询用用户条件，站点使用独立全站查询。

## 后台内容与导航

| 方法与路径 | 请求 → 响应 |
| --- | --- |
| `GET /admin/books` | → `Book[]`，包含空词书；此管理目录的 wordCount/learnedCount/dueCount 可用，新增入口聚合从公开 /books 或详情 book 读取。 |
| `POST /admin/books` | `{title,subtitle?,description?,category?,color?}` → `Book`（201）。 |
| `PATCH /admin/books/{id}` | 提交需更新的词书字段 → `Book`，未提交字段在事务中保留当前值。 |
| `DELETE /admin/books/{id}` | → `{ok:true}`，删词／进度／收藏，保留历史文本快照。 |
| `POST /admin/books/{id}/words` | `{words:[{text,meaning,phonetic?,example?,exampleMeaning?}]}` → `{imported:number}`，每批 1–5000、先全量校验再原子 upsert。 |
| `DELETE /admin/words/{id}` | → `{ok:true}`，删对应进度／收藏，保留历史。 |
| `GET /admin/users?paged=1&offset=0&limit=50&q=&kind=all` | → `{items:[{id,name,email,role,guest,dailyGoal,learnedCount,createdAt}],total,offset,limit,hasMore}`。kind 为 all/guest/registered/admin（registered 含正式管理员），q 搜姓名／邮箱、最多 200 字节；无 paged=1 返回相同分页范围的数组。 |
| `GET /admin/navigation?versioned=1` | → `{items:Navigation[],version}`，同一事务读取；无 versioned=1 保留数组响应。 |
| `PUT /admin/navigation` | `{items:Navigation[],version}` → `{items,version:新版本}`。缺失、null 或负 version 返回 428；JSON 类型／非整数等解码错误 400；旧版本 409，保留新配置。 |

词书上限：标题 1–120 字，副标题 200，介绍 2000，分类 40，颜色 #rrggbb。单词 text/meaning 必填、最多 128／2000 字；音标 200、例句／译文各 2000。按 Unicode 字符检查，去首尾空白，拒绝不支持的控制字符；同批禁止大小写不敏感的重复词面。

导入按 SQLite NOCASE（ASCII 大小写不敏感）匹配同词书词面并保留 ID；已有词省略可选字段保留原值，显式空字符串清除，新词省略用空值。实际内容变化才递增 contentVersion；相同内容不变。变化时未完成 learn 回 stage0 并递增 revision，已完成阶段／既有掌握保留；旧题靠 contentVersion 拒绝。坏项 400 `{error,index,word,field}`，index 从 0 起、提示序号从 1 起，整批不写入。

`Navigation={id,label,path,icon,enabled,sortOrder}`，固定 overview `/admin`、books `/admin/books`、users `/admin/users`、navigation `/admin/navigation`。PUT 须含全部四个模块、ID／排序唯一、路由固定、图标在支持集合内，navigation 始终启用。保存使用 JSON version 比较交换，不使用 If-Match；前端只解析已知模块，不执行任意代码。

## 运行、代理与持久化

Go 入口 `backend/cmd/server`，模块 `github.com/KoinaAI/Word/backend`。PORT 默认 8080，DB_PATH 默认 data/word.db，WEB_DIR 指向 SPA；ADMIN_EMAIL 默认 admin@word.local，ADMIN_PASSWORD（12–72 字节）显式初始化管理员，不设固定默认密码。设置 ADMIN_PASSWORD 时非法 ADMIN_EMAIL 启动失败；非法代理配置始终启动失败。

COOKIE_SECURE 控制 Secure Cookie（本地 Compose 默认 false）。写入校验 Origin，仅显式 DEV_ORIGIN 允许开发源携带凭据。静态／health 不读身份；数据库故障不伪装匿名。`GET /health` 数据库可用返回 `{status:"ok"}`，否则 503。

TRUSTED_PROXIES 默认空，支持逗号分隔 CIDR／单 IP，例如 `127.0.0.1/32,::1/128`。仅直接连接可信时读 X-Forwarded-For，由右往左剥可信代理，首个不可信客户端停止；非法链回退直接地址。应填实际代理范围，不能信任全部地址。

Docker 为 JS/CSS/SVG/JSON 生成 .gz；Go 按 Accept-Encoding 选已有变体、设置 Vary 并保留 Content-Type；无变体或不接受 gzip 时回原文件。支持 HEAD、条件请求和所选表示的 Range；哈希 /assets/ 长期 immutable、入口 no-cache。不承诺 API 动态压缩。

启动执行版本化、事务式 SQLite 迁移与外键检查，补齐旧库 submitted_word_id、自增 ID、内容版本、撤销、收藏版本和查询索引，保留数据及已有自增高水位；现有收藏回填 revision=1。**早期已删词且 answers.word_id=NULL 的原 ID 无法恢复**：迁移用 `-answer.id` 占位，保留历史且不撞真实 ID，但同一已删词多条记录不能精确去重，历史按日词数可能偏高；仍有 word_id 的可准确回填。

首次初始化含六本标注“精选”的小词书，每本至少 20 个原创双语词条，不宣称完整考试覆盖。所有统计来自数据库。
