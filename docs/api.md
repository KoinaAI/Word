# API contract

All API routes under `/api`. JSON keys camelCase. Success returns payload directly, errors `{error:string}` with meaningful status. Session HttpOnly same-site cookies. Admin routes require admin role. Dates ISO8601, daily date YYYY-MM-DD UTC. No fake analytics.

- POST /auth/guest => User (create isolated guest session; return existing current user if authenticated)
- POST /auth/register {name,email,password} => User (convert current guest, preserve progress)
- POST /auth/login {email,password} => User
- POST /auth/logout => {ok:true}
- GET /me => User {id,name,email,role:"user"|"admin",guest:boolean,dailyGoal:number,examDate:string,activeBookId:number}
- PATCH /me {dailyGoal?,examDate?,activeBookId?,name?} => User
- GET /books?q=&category= => Book[] {id,title,subtitle,description,category,color,wordCount,learnedCount,dueCount}
- GET /books/{id} => {book:Book,words:Word[]}
- GET /study?bookId=1&mode=learn|review|sprint|reinforce => {book:Book,words:Word[],total:number}
- Word {id,bookId,text,phonetic,meaning,example,exampleMeaning,favorite:boolean,status:"new"|"learning"|"mastered",reinforce:boolean,dueAt?:string}
- POST /study/answer {wordId:number,mode:"learn"|"review"|"sprint"|"reinforce",answer:"known"|"unknown"|"unsure-known"|"unsure-unknown",eventId:string} => {ok:true} (idempotent unique eventId per user)
- sprint known -> mastered, schedule next review; unknown / unsure-unknown -> do not change mastery or due dates, retain unknown queue; unsure-known -> learning + reinforce flag, schedule next review. Reinforce known clears reinforce and schedules. Learn/review unknown -> learning with 10-minute relearn. SM-2 style 1/3/7+ day intervals for known, eased with repetitions. Never fabricate proficiency.
- POST /favorites/{wordId} {favorite:boolean} => {ok:true}
- GET /favorites => Word[]
- GET /stats => {learned:number,due:number,reinforce:number,favorites:number,today:number,streak:number,totalWords:number,activity:[{date:string,count:number}],recent:[{id:number,text:string,meaning:string,answer:string,createdAt:string}]}
- GET /admin/stats => {users:number,books:number,words:number,answers:number,activeToday:number,activity:[{date:string,count:number}],recent:[{id:number,text:string,meaning:string,answer:string,createdAt:string}]}
- GET /admin/books => Book[] (including empty books)
- POST /admin/books {title,subtitle,description,category,color} => Book
- PATCH /admin/books/{id} same fields => Book
- DELETE /admin/books/{id} => {ok:true}
- POST /admin/books/{id}/words {words:[{text,phonetic,meaning,example,exampleMeaning}]} => {imported:number} (atomic validated upsert, max 5000 words)
- DELETE /admin/words/{id} => {ok:true}
- GET /admin/users => [{id,name,email,role,guest,dailyGoal,learnedCount,createdAt}]
- GET /admin/navigation => Navigation[] {id,label,path,icon,enabled,sortOrder}; initial modules overview /admin, books /admin/books, users /admin/users, navigation /admin/navigation. GET available to admin only; frontend loads it and resolves matching allowed module, never arbitrary code.
- PUT /admin/navigation {items:Navigation[]} => Navigation[]; restrict path to supported admin modules, validate uniqueness, keep navigation module enabled.
- GET /health => {status:"ok"}

Go backend: `backend/cmd/server`, module `github.com/KoinaAI/Word/backend`; port env PORT default 8080, DB_PATH default data/word.db, WEB_DIR optional static SPA folder; ADMIN_EMAIL default admin@word.local, ADMIN_PASSWORD required for admin initialization (never fixed password); allow localhost development guest access. Production cookie Secure controlled COOKIE_SECURE env (default false for local Compose), SameSite=Lax and reject cross-origin mutations via Origin host checks (allow localhost Vite 5173 in development only if env DEV_ORIGIN is set). Auth rate limiting. Seed 6 curated mini books (explicit "精选" sample contents, no misleading claimed full coverage) with at least 20 original bilingual words each. All stats backed by database.
