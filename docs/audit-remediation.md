# 审计修复台账

本台账对应 2026-11-16 审计的 A01–A47、D01–D03，编号保持不变。它记录当前实现、已有定点证据及尚待确认的环节；“已实现”不代表集中浏览器、最终镜像、远端 CI 或自动发布已经通过。

## 证据口径

- **定点通过**：实现代理已回报执行通过的相关测试；本次文档整理只读核对源码，没有再次运行应用测试。
- **待浏览器**：逻辑或样式已落地，但跨标签页、慢请求、390px 布局等仍须在集成后集中操作核验。
- **待镜像**：构建脚本／服务行为已实现，最终提交对应镜像的构建、启动、重启、退出或 gzip 协商尚未统一验收。
- **远端已应用／待远端**：只用于有明确远端回报的状态；本地 JSON、工作流及测试不能代替分支保护读回或 GHCR 发布成功。

定点证据索引：

| 编号 | 已有证据与范围 |
| --- | --- |
| E01 | [migrations_test.go](../backend/internal/app/migrations_test.go)：真实旧 schema 的数据／外键／ID 迁移、自增高水位及混合旧表重建，3 项定点通过。 |
| E02 | [foundation_test.go](../backend/internal/app/foundation_test.go)：PATCH 未提交列保留、身份屏障、会话续期、可信代理与限流隔离、非法配置、静态资源不查身份及 DB 故障。原相关定点通过；后续续期协调变更需按最终实现补验。 |
| E03 | [learning_queries_test.go](../backend/internal/app/learning_queries_test.go)：分页／状态计数／优先续学、230 词游标样本、有界候选／收藏隔离，定点通过。 |
| E04 | [learning_audit_test.go](../backend/internal/app/learning_audit_test.go)：旧内容拒绝；撤销本人隔离、幂等、原无进度恢复、revision 单调、原事件重放拒绝、后续练习及 120 秒窗口，定点通过。既有 [learning_test.go](../backend/internal/app/learning_test.go)、[learning_stages_test.go](../backend/internal/app/learning_stages_test.go) 的直接依赖回归也已定点通过。 |
| E05 | [admin_audit_test.go](../backend/internal/app/admin_audit_test.go)：导入省略／清空、内容版本、仅未完成阶段失效、坏项原子性、导航旧版本拒绝、用户分页筛选，定点通过；仅大小写变化的内容版本回归有单独用例。 |
| E06 | [stats_foundation_test.go](../backend/internal/app/stats_foundation_test.go)：个人索引查询计划及 undone 不计 activity／recent／streak／today，定点通过。 |
| E07 | [static_foundation_test.go](../backend/internal/app/static_foundation_test.go)：gzip 解码、Content-Type／Vary、HEAD、Range、q=0 协商，定点通过。 |
| E08 | [study-quiz.test.ts](../web/tests/study-quiz.test.ts)：词性／释义去重、等价拼写、缩写标点、大队列去重、确认前不前进等纯逻辑，相关定点通过；配套 [learn-round.test.ts](../web/tests/learn-round.test.ts) 描述两阶段和恢复约束。 |
| E09 | [study-flow.test.ts](../web/tests/study-flow.test.ts)：揭义只改变会的去向、不会词保留、仅确认撤销最新本地事件并移除汇总效果，2 项定点通过。 |
| E10 | [library-cache.test.ts](../web/tests/library-cache.test.ts)：数组／详情 words／分页 items 的收藏更新、无关引用保留，5 项定点通过。 |
| E11 | [form-validation.test.ts](../web/tests/form-validation.test.ts)：Unicode 昵称、UTF-8 密码、导入省略与清空、具体坏项／字段、坏 JSON 与批次上限，6 项定点通过。 |
| E12 | [favorite-mutations.test.ts](../web/tests/favorite-mutations.test.ts)、[favorite-request.test.ts](../web/tests/favorite-request.test.ts)：跨页面串行、身份 epoch、未知结果／CAS 冲突重试共 5 项定点通过；[favorite_revision_test.go](../backend/internal/app/favorite_revision_test.go) 覆盖迟到请求屏障、取消后版本保留及 schema v1 回填，集成者回报后端 CAS 及直接依赖共 5 项通过。 |
| E13 | [test_check_results.py](../scripts/test_check_results.py)：缺许可构建证据失败、精确 SHA／可信作者／最新状态、后端跳过不能用授权证明代替，4 项定点通过。 |
| E14 | [draft-completion.test.ts](../web/tests/draft-completion.test.ts)：旧保存完成后保留后续编辑、baseline 比较、对象字段顺序、存储异常、当前值重基及旧完成不覆盖新 baseline，10 项定点通过。 |
| E15 | [session-lock.test.ts](../web/tests/session-lock.test.ts)：调度器覆盖 IndexedDB 排他至响应解析完成、取消仍持锁、排队取消不发请求、Web Locks 优先／失败不重放、无存储禁续期、keepalive 失败，7 项定点通过，helper 类型检查通过。集成者另在真实 IAB 双标签页 harness 强制 IDB：A 结束 1794811904261ms，B 于 1794811904262ms 才开始，两页均完成 indexeddb；此证据仅确认锁排他，不等于完整账号切换／30 天生命周期已实测。 |

## A01–A47

| 编号／原问题 | 当前修复与实现位置 | 已有验证及未完成环节 |
| --- | --- | --- |
| **A01 · P1** 跨标签页旧页面误写新账号 | [api.ts](../web/src/lib/api.ts)、[main.tsx](../web/src/main.tsx) 取消旧 epoch 请求、广播后核实身份并重挂载；[app.go](../backend/internal/app/app.go) 用 X-Word-User-ID 在写入前返回 SESSION_CHANGED。 | E02 服务端屏障；**待浏览器**双标签页设置／答案、未收到广播路径、迟到响应与 Cookie 协调。 |
| **A02 · P1** 早期持久库没有实际迁移 | [migrations.go](../backend/internal/app/migrations.go)、[schema.sql](../backend/internal/app/schema.sql) 版本化事务迁移、外键校验、补 submitted_word_id 和自增 ID。 | E01；**待镜像**真实旧库启动及重启。已删词原 ID 丢失的去重局限见下文，不标全部历史精确恢复。 |
| **A03 · P2** 反代合并全站限流桶 | [app.go](../backend/internal/app/app.go) 解析可信代理并由右向左处理 XFF；[main.go](../backend/cmd/server/main.go)、[compose.yaml](../compose.yaml) 注入 TRUSTED_PROXIES。 | E02 可信／不可信／非法链和不同客户端限流；实际代理地址需部署时正确配置。 |
| **A04 · P2** PATCH 覆盖未提交设置 | [auth.go](../backend/internal/app/auth.go) 动态更新提交列并返回当前资料；[settings.tsx](../web/src/pages/settings.tsx) 对原草稿 baseline 只发修改字段。 | E02 陈旧请求保留其他列；**待浏览器**草稿恢复后保存与并发选书。 |
| **A05 · P2** 导入省略字段清空旧值 | [admin.go](../backend/internal/app/admin.go) 区分缺省与显式空；[form-validation.ts](../web/src/lib/form-validation.ts)、[admin-books.tsx](../web/src/pages/admin-books.tsx) 保留缺省语义及提示。 | E05、E11 覆盖保留／清空／原子性；**待浏览器**文件和文本导入流程。 |
| **A06 · P2** 保存中编辑被成功回调丢弃 | [settings.tsx](../web/src/pages/settings.tsx)、[admin-books.tsx](../web/src/pages/admin-books.tsx)、[admin-navigation.tsx](../web/src/pages/admin-navigation.tsx) 保存／读文件期间冻结字段；[draft-completion.ts](../web/src/lib/draft-completion.ts) 保护旧请求完成前后新草稿。 | E14、类型检查；**待浏览器**慢请求下输入、关闭、草稿保留。 |
| **A07 · P2** 旧题认证新版词条 | [admin.go](../backend/internal/app/admin.go) 实质变化递增 contentVersion 并使未完成阶段失效；[learning.go](../backend/internal/app/learning.go)、[study.tsx](../web/src/pages/study.tsx) 提交并核对版本。 | E04、E05；**待浏览器**旧题 409、刷新后新题、大小写内容变化。兼容旧客户端允许不带版本，见 API 合同。 |
| **A08 · P2** 导航整表覆盖其他管理员 | [admin.go](../backend/internal/app/admin.go) 同快照读取 JSON version、PUT 比较交换；[admin-navigation.tsx](../web/src/pages/admin-navigation.tsx) 保留冲突草稿，忽略迟到旧响应。 | E05 陈旧编辑 409／缺版本 428；**待浏览器**双管理员及载入新配置。 |
| **A09 · P2** 活跃访客 30 天失去入口 | [app.go](../backend/internal/app/app.go) 同 token 服务端续期，仅协调 `/me` 发 Cookie；[api.ts](../web/src/lib/api.ts)、[session-lock.ts](../web/src/lib/session-lock.ts) Web Locks 优先、HTTP LAN 用 IndexedDB 排他 fallback。 | E02、E15，真实浏览器 IDB 排他已确认；**待完整浏览器流程**切账号迟到续期、双能力均不可用降级。只在无法协调时不续浏览器 Cookie，不把所有 HTTP LAN 描述为固定过期。 |
| **A10 · P2** 小目标挤掉半学词 | [learning.go](../backend/internal/app/learning.go) learn 优先 stage1，再按 ID；[study.tsx](../web/src/pages/study.tsx) 新一组 after=0。 | E03；**待浏览器**高 ID stage1 后目标减至 1 的续学。 |
| **A11 · P2** 同义拼写被误判 | [study-quiz.ts](../web/src/lib/study-quiz.ts) 同完整规范释义等价拼写和提示，无干扰项回退拼写；[learn-round.ts](../web/src/lib/learn-round.ts) 保持 stage0 先认识。 | E08；**待浏览器**同义词小词书输入与反馈。 |
| **A12 · P2** 词性缩写令多选项都对 | [study-quiz.ts](../web/src/lib/study-quiz.ts) 规范常见词性、按共享义项排除干扰词，保留普通英文前缀。 | E08 POS／缩写标点及重复义项用例；**待浏览器**最终题面。 |
| **A13 · P2** pending 锁住退出 | [api.ts](../web/src/lib/api.ts) 有限超时＋signal；[study.tsx](../web/src/pages/study.tsx) 随时退出、按身份／词书／模式暂存原事件并重入确认。 | 既有答案幂等及阶段确认测试配套；**待浏览器**响应丢失／未提交两路径、退出重入。 |
| **A14 · P2** 学习重开星标回退 | [study.tsx](../web/src/pages/study.tsx)、[library-cache.ts](../web/src/lib/library-cache.ts)、[favorite-mutations.ts](../web/src/lib/favorite-mutations.ts) 同步 words／vocabulary／items、串行同词意图；[learning.go](../backend/internal/app/learning.go) 用持久化 favorite revision 拒绝旧写入。 | E10、E12；**待浏览器**收藏后重开、切页面与迟到 GET。 |
| **A15 · P2** 一词收藏锁全表 | [books.tsx](../web/src/pages/books.tsx) 逐词 pending、乐观星标、取消旧读取并局部刷新；[favorite-request.ts](../web/src/lib/favorite-request.ts) 确认 revision 后 CAS 写入，未知结果重新确认。 | E10、E12；**待浏览器**慢网络同时收藏不同词、分页／搜索、超时迟到写竞态。 |
| **A16 · P2** 主按钮白底白字 | [styles.css](../web/src/styles.css) 移除覆盖语义主按钮背景的规则，保留组件 variant。 | 源码／类型检查；**待浏览器**后台创建和导航保存的实际颜色截图。 |
| **A17 · P2** 速刷移位与长释义滚动 | [study.css](../web/src/pages/study.css)、[study.tsx](../web/src/pages/study.tsx) 固定三槽、独立释义滚动、换词复位。 | E09 逻辑配套；**待浏览器**390px 长释义、揭义前后按钮位置、连续切词。 |
| **A18 · P2** lazy 失败空白无恢复 | [route-boundary.tsx](../web/src/components/route-boundary.tsx)、[main.tsx](../web/src/main.tsx) 捕获路由渲染／chunk 失败，提供重新加载和首页恢复。 | 源码复核；**待浏览器**受控 chunk 失败恢复，不能把 Suspense 等同错误验证。 |
| **A19 · P2** 大队列二次生成成本 | [study-quiz.ts](../web/src/lib/study-quiz.ts) Set 去重、一次规范池、每题有界抽样；[learning.go](../backend/internal/app/learning.go) 限批及候选。 | E08 大队列逻辑／E03 有界响应；**待浏览器**最终交互，不把 Node 测量当移动端性能结果。 |
| **A20 · P2** 词条／后台表全 DOM | [books.tsx](../web/src/pages/books.tsx)、[admin-books.tsx](../web/src/pages/admin-books.tsx)、[admin-insights.tsx](../web/src/pages/admin-insights.tsx) 词条／收藏／用户服务端每页 50；后台词书目录本地分页每页 50。 | E03、E05 接口范围；**待浏览器**请求和 DOM 数量。词书目录接口仍数组，不宣称全部目录已服务端分页。 |
| **A21 · P2** 详情和学习无返回上限 | [learning.go](../backend/internal/app/learning.go) 详情分页、学习 limit／after、候选上限；[study.tsx](../web/src/pages/study.tsx) 不额外下载整书。 | E03 230 词游标、上限拒绝、候选无例句；**待浏览器**跨批不漏不重与新组提示。 |
| **A22 · P2** 用户全量返回逐项聚合 | [admin.go](../backend/internal/app/admin.go) 过滤后分页，仅聚合当页；[admin-insights.tsx](../web/src/pages/admin-insights.tsx) 服务端 q／kind 与翻页。 | E05 用户分页／筛选；**待浏览器**筛选重置、加载范围。 |
| **A23 · P2** 删书逐词扫全站子表 | [schema.sql](../backend/internal/app/schema.sql)、[migrations.go](../backend/internal/app/migrations.go) 为 active_book_id 和各 word_id 外键子列补索引。 | E01 迁移配套、源码索引复核；没有用原审计基准当作修复后生产性能证明。 |
| **A24 · P2** 个人统计扫全站历史 | [stats.go](../backend/internal/app/stats.go) 分个人／全站条件，直接 user_id 过滤；schema 补近期查询索引。 | E06 查询计划与结果；生产负载未压测。 |
| **A25 · P2** 签发会话全表清理扫描 | [schema.sql](../backend/internal/app/schema.sql) sessions_expiry 索引；[app.go](../backend/internal/app/app.go) 过期条件清理。 | E01 迁移／E02 签发配套；源码确认索引，不宣称大规模实测吞吐。 |
| **A26 · P2** 收藏从全词库起扫 | [learning.go](../backend/internal/app/learning.go) 从当前用户 indexed favorites JOIN words，分页与计数分离。 | E03 收藏分页／身份隔离；源码复核查询起点。 |
| **A27 · P2** 首屏大包且无压缩 | [main.tsx](../web/src/main.tsx) 页面 lazy、[shared.tsx](../web/src/components/shared.tsx) 图表拆分、[styles.css](../web/src/styles.css) 按用量引入；[Dockerfile](../Dockerfile)、[app.go](../backend/internal/app/app.go) 预压缩和协商。 | E07；**待最终构建／镜像**体积与 gzip 回包，不能复用修复前包体积作为新结果。 |
| **A28 · P2** 管理员邮箱非法仍启动 | [app.go](../backend/internal/app/app.go) 初始化校验有效邮箱，拒绝无效配置。 | E02 启动配置定点通过。 |
| **A29 · P3** 第一阶段仍标未学 | [learning.go](../backend/internal/app/learning.go) 分 newCount/unstartedCount/learningCount；[books.tsx](../web/src/pages/books.tsx) stage1 标签／筛选。 | E03 计数与过滤；**待浏览器**退出后标签和入口。 |
| **A30 · P3** 速刷数字不等于队列 | [learning.go](../backend/internal/app/learning.go) sprintCount 同实际条件；[books.tsx](../web/src/pages/books.tsx) 空队列禁用并指向巩固。 | E03；**待浏览器**全为待巩固时入口。 |
| **A31 · P3** 到期数字不随时间变 | [home.tsx](../web/src/pages/home.tsx)、[books.tsx](../web/src/pages/books.tsx)、[main.tsx](../web/src/main.tsx) 前台可见轮询和聚焦刷新，题目快照单独稳定。 | 源码／类型检查；**待浏览器**跨到期阈值与重新聚焦。 |
| **A32 · P3** 速刷误点无纠正 | [learning.go](../backend/internal/app/learning.go) undo＋[app.go](../backend/internal/app/app.go) 已注册路由；[study-flow.ts](../web/src/lib/study-flow.ts)、[study.tsx](../web/src/pages/study.tsx) 确认后回退与未知结果锁。 | E04、E06、E09；**待浏览器**撤销、重试、另一页后续练习冲突及统计回退。 |
| **A33 · P3** 数量控件范围／输入不一致 | [settings.tsx](../web/src/pages/settings.tsx) 可见 number 输入，1–500、step1、即时校验。 | 源码／类型检查；**待浏览器**直接键入 1／201／500 与无效值。 |
| **A34 · P3** 昵称和密码约束不一致 | [form-validation.ts](../web/src/lib/form-validation.ts)、[settings.tsx](../web/src/pages/settings.tsx) 昵称 Unicode 字符、密码 UTF-8 字节对齐后端并就地提示。 | E11；**待浏览器**中文密码、astral 昵称输入。 |
| **A35 · P3** 草稿离开／关闭无保护 | [use-form-draft.ts](../web/src/hooks/use-form-draft.ts)、[admin-common.tsx](../web/src/pages/admin-common.tsx)、[draft-completion.ts](../web/src/lib/draft-completion.ts) 账号资源隔离草稿、baseline、完成版本保护、beforeunload 和关闭选择，存储失败提示。 | E14；**待浏览器**恢复、误关闭、配额／禁用存储。 |
| **A36 · P3** 示例覆盖导入草稿 | [admin-books.tsx](../web/src/pages/admin-books.tsx) 非空内容禁用填例，文件读取冻结操作并说明替换语义。 | 源码／类型检查；**待浏览器**非空草稿、文件读取中操作。 |
| **A37 · P3** 导入错误不定位坏项 | [admin.go](../backend/internal/app/admin.go)、[form-validation.ts](../web/src/lib/form-validation.ts) 序号／词／字段定位，先校验后事务写入。 | E05、E11；**待浏览器**长批次错误提示可见性。 |
| **A38 · P3** 登录依赖访客成功 | [settings.tsx](../web/src/pages/settings.tsx) 身份读取独立、失败仍显示登录表单，不自动 POST guest。 | 源码复核；**待浏览器**guest 失败／限流时登录入口。 |
| **A39 · P3** 注册按钮落到登录 | [settings.tsx](../web/src/pages/settings.tsx) 注册保留进度直达 `/login?mode=register`。 | 源码复核；**待浏览器**访客注册及保留原进度。 |
| **A40 · P3** 登录页操作身份失真 | [settings.tsx](../web/src/pages/settings.tsx) 正式账号注册前明确退出，返回学习空间文案随身份变化，409 提供恢复入口。 | 源码复核；**待浏览器**已登录／读取身份失败的注册流程。 |
| **A41 · P3** 管理员落到停用概览 | [settings.tsx](../web/src/pages/settings.tsx)、[layout.tsx](../web/src/components/layout.tsx) 登录与侧栏后台总入口均选首个启用模块，读取失败回常驻导航。 | 源码复核；**待浏览器**关闭概览后的登录和侧栏进入。 |
| **A42 · P3** 后台两个 current | [layout.tsx](../web/src/components/layout.tsx) 根据最具体匹配只激活一个管理入口。 | 源码复核；**待浏览器**详情路由及侧栏截图。 |
| **A43 · P3** 拼写题不获焦 | [study.tsx](../web/src/pages/study.tsx) 解锁和题型切换后聚焦拼写输入，不聚焦无输入 section。 | 源码复核；**待浏览器**首题／纠错／下一题键盘输入。 |
| **A44 · P3** 统计脚注／模式字过小 | [styles.css](../web/src/styles.css)、[home-library.css](../web/src/pages/home-library.css) 扩大对应字号和触控尺寸。 | 源码／类型检查；**待浏览器**390px 字号、按钮触控及换行。 |
| **A45 · P3** 路由缺焦点与播报 | [layout.tsx](../web/src/components/layout.tsx)、[main.tsx](../web/src/main.tsx)、[settings.tsx](../web/src/pages/settings.tsx) 页面标题、主内容／认证标题焦点与路由播报。 | 源码复核；**待浏览器**键盘普通路由／登录跳转，不宣称已做读屏实测。 |
| **A46 · P3** 换词书残留筛选 | [books.tsx](../web/src/pages/books.tsx) 按 bookId 重挂载详情，并重置搜索／状态／页码。 | 源码／类型检查；**待浏览器**快速导航跨书。 |
| **A47 · P3** 后台目标列语义错误 | [admin-insights.tsx](../web/src/pages/admin-insights.tsx) 改为“每轮新词”，与设置和 API 含义一致。 | 源码复核；**待浏览器**后台表头。 |

## D01–D03

| 编号 | 当前实现与证据 | 状态／关闭条件 |
| --- | --- | --- |
| **D01 · P2** PR 授权构建跳过仍汇总成功 | [checks.yml](../.github/workflows/checks.yml)、[check_results.py](../scripts/check_results.py) 缺授权不能假绿。仅接受相同完整 SHA、同仓库受信 push 的 frontend/container 成功，或受信维护者的精确 SHA licensed-build 证明。最新 pending／failure 撤销旧成功；后端不能用许可证明代替。E13 通过。 | **本地实现，待最终 SHA 远端验证**。最终镜像必须实际构建、verify／smoke 后才能给该 SHA 证明；squash／merge／rebase 后 SHA 改变不能沿用。HEROUI_KEY 不是官方 HEROUI_AUTH_TOKEN，不自动替换或发送到官方安装器。 |
| **D02 · P2** main 无强制检查保护 | [branch-protection.json](branch-protection.json) 描述严格 results、要求 PR、对管理员执行、禁止 force／delete、会话讨论需解决。2026-11-16 集成者已 PUT 远端并读回：strict results、PR、enforce_admins、禁止 force／delete。 | **远端已应用并读回**。这是当前配置证据，不代表尚未产生的最终候选 CI 已通过。PR 审批数为 0，不额外承诺独立人工审批门槛。 |
| **D03 · P2** GHCR 自动发布未闭环 | [release.yml](../.github/workflows/release.yml) 补前端逻辑验证和 write_package 诊断；[v0.1.0 交付记录](releases/v0.1.0.md) 保留旧运行证据。[run 43619366733](https://github.com/KoinaAI/Word/actions/runs/43619366733/job/132521313443) 发布步骤确切为 `denied: permission_denied: write_package`。 | **仍受外部权限阻塞**。需用户在[包设置](https://github.com/orgs/KoinaAI/packages/container/word/settings)核对并授予 KoinaAI/Word 的 Actions 写权限，再由实际发布及 digest 回拉关闭。包 API 不含 repository／permissions 不能证明“未关联”；不能仅改工作流 permissions 就宣称修复。 |

## 明确边界与待集中验收

- **历史去重不可恢复部分**：8120e2f 之前已删词且 `answers.word_id=NULL`，原词 ID 已丢失。迁移用 `-answer.id` 作为每条答案独立占位，保留历史且不与真实 ID 相撞；同一已删词的多次记录无法重新精确去重，历史按日词数可能偏高。仍有 word_id 的记录可准确回填。
- **兼容请求**：服务端允许缺 X-Word-User-ID／contentVersion 的旧客户端；当前浏览器必须发送。不能把兼容请求描述为具有相同的身份／内容屏障。导航 PUT 缺 version 则明确返回 428，旧脚本须同步。
- **集中浏览器 TODO**：以最终候选覆盖双标签页身份、慢答案退出重入、未知撤销、跨页面收藏、201 词跨批及最后页缩减、导入旧题／导航冲突、390px 长释义／拼写焦点／主按钮及路由恢复；移除条件是记录实际操作和关键截图，不是只看源码。
- **最终镜像 TODO**：最终候选构建，验证 revision／镜像 ID，运行容器并检查 gzip、旧库升级、重启持久化与 SIGTERM；移除条件是对应候选实际通过，不复用修复前镜像结果。
- **远端 TODO**：最终 SHA 的 results／授权构建证据与 GHCR 权限处理后发布、digest 回拉分别记录。D02 配置已生效，不替代 D01 最终检查；D03 未成功前不标自动发布完成。

详细数据及错误语义见 [API 合同](api.md)，用户流程见[学习体验设计](learning-experience.md)。
