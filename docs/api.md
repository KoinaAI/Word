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
- Word {id,bookId,text,phonetic,meaning,example,exampleMeaning,favorite:boolean,status:"new"|"learning"|"mastered",reinforce:boolean,dueAt?:string,learnStage:0|1|2,learnRevision:number}
- POST /study/answer {wordId:number,mode:"learn"|"review"|"sprint"|"reinforce",answer:"known"|"unknown"|"unsure-known"|"unsure-unknown",eventId:string,learnStage?:0|1,learnRevision?:number}. Non-learn modes return {ok:true} and reject learnStage/learnRevision. Event IDs are unique per user.
- Learn requires both learnStage and learnRevision from the current Word. Stage 0 asks English/phonetic -> Chinese; stage 1 asks Chinese -> English. A known answer advances one stage; unknown resets this word to stage 0. Every accepted answer increments learnRevision. Until stage 2, status stays new and no review is scheduled; only completing both stages marks mastered and schedules the first review. Wrong answers can restart indefinitely. The learn response is {ok:true,learnStage:0|1|2,learnRevision:number,completed:boolean}. GET study/book detail exposes the stored stage/revision so leaving and returning resumes the unfinished word.
- Learn retries must reuse the exact payload and eventId. They return the original saved stage/revision/completed snapshot, including after a later answer or word deletion. Reusing an event ID with different input or submitting an outdated stage/revision returns 409; missing/invalid fields return 400. Other modes that change memory reset the learning stage and increment its revision, so a stale learn tab cannot advance after a word leaves and later returns to the new-word queue. A sprint unknown/unsure-unknown leaves partial learning progress unchanged.
- Sprint known -> mastered, schedule next review; unknown / unsure-unknown -> do not change mastery or due dates, retain unknown queue; unsure-known -> learning + reinforce flag, schedule next review. Reinforce known clears reinforce and schedules; reinforce unknown returns the word to new. Review unknown -> learning with 10-minute relearn. SM-2 style 1/3/7+ day intervals for completed learn or other known ratings, eased with repetitions. Never fabricate proficiency.
- POST /favorites/{wordId} {favorite:boolean} => {ok:true}
- GET /favorites => Word[]
- GET /stats => {learned:number,due:number,reinforce:number,favorites:number,today:number,streak:number,totalWords:number,activity:[{date:string,count:number}],recent:[{id:number,text:string,meaning:string,answer:string,createdAt:string}]}
- Each accepted learning stage is a real answer event: activity counts attempts; today counts distinct submitted word IDs across all modes, so practicing one word repeatedly still counts one word that UTC day. A recent known answer means that question was answered correctly; it does not by itself imply both new-learning stages are complete. Mastered totals come only from persistent memory status.
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
