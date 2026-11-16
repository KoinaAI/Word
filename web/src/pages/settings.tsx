import { useEffect, useState, type SubmitEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Input, Label, Switch, TextField } from '@heroui/react'
import { Segment } from '@heroui-pro/react/segment'
import { ArrowRight, BookOpen, Check, Gear, ShieldCheck, Volume } from '@gravity-ui/icons'
import { toast } from 'sonner'
import { ApiError, api, clearAuthSession, json, syncAuthUser, useUser } from '@/lib/api'
import { pronounce } from '@/lib/speech'
import { validatePassword, validateProfileName } from '@/lib/form-validation'
import { useFormDraft } from '@/hooks/use-form-draft'
import type { Navigation, User } from '@/lib/types'
import { Failure, Loading, PageHeading } from '@/components/shared'

export function SettingsPage() {
  const query = useUser()
  if (query.isPending) return <Loading />
  if (query.error || !query.data) return <Failure error={query.error} retry={query.refetch} />
  return <SettingsForm key={query.data.id} user={query.data} />
}
function SettingsForm({ user }: { user: User }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const draft = useFormDraft(`word-draft:${user.id}:settings`, { name: user.name, goal: String(user.dailyGoal), exam: user.examDate?.slice(0, 10) || '' })
  const { name, goal, exam } = draft.value
  useEffect(() => {
    const latest = { name: user.name, goal: String(user.dailyGoal), exam: user.examDate?.slice(0, 10) || '' }
    if (!draft.dirty && JSON.stringify(latest) !== JSON.stringify(draft.baseline)) draft.reset(latest)
  }, [user.name, user.dailyGoal, user.examDate, draft.dirty])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [autoAudio, setAutoAudio] = useState(localStorage.getItem('word-auto-audio') === 'true')
  const [accent, setAccent] = useState(localStorage.getItem('word-accent') || 'en-US')
  const nameError = validateProfileName(name)
  const goalNumber = Number(goal)
  const goalError = !goal.trim() || !Number.isInteger(goalNumber) || goalNumber < 1 || goalNumber > 500 ? '请输入 1–500 之间的整数。' : ''
  const change = (values: Partial<typeof draft.value>) => { draft.setValue(current => ({ ...current, ...values })); setError('') }
  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending || nameError || goalError) return
    setPending(true); setError('')
    try {
      const changed = {
        ...(name.trim() !== draft.baseline.name ? { name: name.trim() } : {}),
        ...(goalNumber !== Number(draft.baseline.goal) ? { dailyGoal: goalNumber } : {}),
        ...(exam !== draft.baseline.exam ? { examDate: exam } : {}),
      }
      const result = await api<User>('/me', json('PATCH', changed))
      client.setQueryData(['me'], result)
      draft.reset({ name: result.name, goal: String(result.dailyGoal), exam: result.examDate?.slice(0, 10) || '' })
      toast.success('学习计划已保存')
    } catch (e) { setError((e as Error).message) } finally { setPending(false) }
  }
  return <div className="page-stack settings-page"><PageHeading eyebrow="按照自己的节奏" title="让学习，更适合你" description="小一点的目标，坚持久一点。找到你舒服的学习方式。" /><form onSubmit={save}><Card><Card.Header><Card.Title>学习计划</Card.Title><Card.Description>每次按自己的精力，学一组新词。</Card.Description></Card.Header><Card.Content className="space-y-7">
    {draft.restored && <p className="text-sm text-muted" role="status">已恢复当前标签页中的未保存草稿。</p>}{draft.storageError && <p role="alert" className="text-sm text-danger">{draft.storageError}</p>}
    <TextField isRequired isDisabled={pending} isInvalid={Boolean(nameError)}><Label>怎么称呼你</Label><Input variant="secondary" value={name} onChange={event => change({ name: event.target.value })} maxLength={80} aria-describedby="profile-name-help" /><p id="profile-name-help" className={`mt-2 text-xs ${nameError ? 'text-danger' : 'text-muted'}`}>{nameError || '最多 40 个字。'}</p></TextField>
    <div className="settings-row"><div><h3>每轮新词数量</h3><p>可直接输入 1–500，每天可以学习多轮。</p></div><TextField isRequired isDisabled={pending} isInvalid={Boolean(goalError)} className="w-28 shrink-0"><Label className="sr-only">每轮新词数量</Label><Input type="number" inputMode="numeric" variant="secondary" value={goal} min={1} max={500} step={1} onChange={event => change({ goal: event.target.value })} aria-describedby="profile-goal-help" /></TextField></div><p id="profile-goal-help" className={`text-xs ${goalError ? 'text-danger' : 'text-muted'}`}>{goalError || '数量仅影响每一轮，不限制当天的学习轮数。'}</p>
    <TextField isDisabled={pending}><Label>目标考试日期（选填）</Label><Input type="date" variant="secondary" value={exam} onChange={event => change({ exam: event.target.value })} /><p className="text-xs text-muted mt-2">用一个明确的日子，给努力一个方向。</p></TextField>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </Card.Content><Card.Footer className="flex-wrap gap-3"><Button type="submit" isPending={pending} isDisabled={!draft.dirty || Boolean(nameError || goalError)}>保存计划 <Check /></Button>{draft.dirty && <Button variant="ghost" isDisabled={pending} onPress={() => draft.reset()}>撤销修改</Button>}<p className="text-xs text-muted">未保存修改会暂存于当前标签页。</p></Card.Footer></Card></form>
  <Card><Card.Header className="pronunciation-header"><Card.Title>发音偏好</Card.Title><Button variant="outline" onPress={() => pronounce('possibility', accent)}><Volume />试听发音</Button></Card.Header><Card.Content className="space-y-6"><div className="settings-row"><div><h3>英语口音</h3><p>使用有道单词发音</p></div><Segment className="word-segment" aria-label="英语口音" selectedKey={accent} onSelectionChange={key => { const value = String(key); setAccent(value); localStorage.setItem('word-accent', value) }}><Segment.Item id="en-US">美式</Segment.Item><Segment.Item id="en-GB">英式</Segment.Item></Segment></div><div className="settings-row"><div><h3>自动发音</h3><p>英译中与速刷自动朗读；中译英答后发音</p></div><Switch aria-label="自动发音" isSelected={autoAudio} onChange={selected => { setAutoAudio(selected); localStorage.setItem('word-auto-audio', String(selected)) }}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch></div></Card.Content></Card>
  <Card><Card.Header><Card.Title>我的账号</Card.Title></Card.Header><Card.Content className="settings-row settings-account"><div><h3>{user.name} <Chip size="sm" variant="soft">{user.guest ? '访客' : user.role === 'admin' ? '管理员' : '学习者'}</Chip></h3><p>{user.guest ? '访客进度随当前浏览器会话保存，注册后可跨设备登录。' : user.email}</p></div><Button variant="outline" onPress={() => navigate(user.guest ? '/login?mode=register' : '/login')}>{user.guest ? '注册保留进度' : '切换账号'}</Button></Card.Content></Card></div>
}

export function LoginPage() {
  const [params, setParams] = useSearchParams()
  const register = params.get('mode') === 'register'
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState({ name: '', email: '', password: '' })
  const [touched, setTouched] = useState(false)
  const [mustLogout, setMustLogout] = useState(false)
  const navigate = useNavigate()
  const client = useQueryClient()
  // Login must remain available if guest creation or the optional identity lookup fails.
  const currentQuery = useQuery<User | null>({ queryKey: ['auth', 'identity'], retry: false, queryFn: async ({ signal }) => { try { return await api<User>('/me', { signal }) } catch (caught) { if (caught instanceof ApiError && caught.status === 401) return null; throw caught } } })
  const current = currentQuery.data
  const nameError = register ? validateProfileName(fields.name) : undefined
  const passwordError = validatePassword(fields.password, register)
  const alreadyRegistered = register && (Boolean(current && !current.guest) || mustLogout)
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); setTouched(true)
    if (pending || nameError || passwordError || alreadyRegistered) return
    setPending(true); setError('')
    try {
      const result = await api<User>(register ? '/auth/register' : '/auth/login', json('POST', { ...(register ? { name: fields.name.trim() } : {}), email: fields.email, password: fields.password }))
      syncAuthUser(client, result)
      toast.success(register ? current?.guest ? '账号已创建，访客进度已保留' : '账号已创建' : '欢迎回来')
      let destination = '/'
      if (result.role === 'admin') {
        try { const navigation = await api<Navigation[]>('/admin/navigation'); destination = [...navigation].filter(item => item.enabled).sort((a, b) => a.sortOrder - b.sortOrder)[0]?.path || '/admin/navigation' }
        catch { destination = '/admin/navigation' }
      }
      navigate(destination, { replace: true })
    } catch (e) { if (register && e instanceof ApiError && e.status === 409 && /先退出/.test(e.message)) setMustLogout(true); setError((e as Error).message) } finally { setPending(false) }
  }
  const switchMode = () => { setParams(register ? {} : { mode: 'register' }); setTouched(false); setError(''); setFields(value => ({ ...value, password: '' })) }
  const logoutForRegistration = async () => {
    if (pending) return
    setPending(true); setError('')
    try { await api('/auth/logout', json('POST')); clearAuthSession(client); client.setQueryData(['auth', 'identity'], null); setMustLogout(false) }
    catch (caught) { setError((caught as Error).message) } finally { setPending(false) }
  }
  return <main className="auth-page"><section className="auth-story"><a href="/" onClick={event => { event.preventDefault(); navigate('/') }} className="brand"><img src="/favicon.svg" alt="" /><span>就背单词</span></a><div><p className="eyebrow">记住单词，也记住每天的进步</p><h1>一个词，<br />一个更大的世界。</h1><p>每天的一点点，终会成为你向前的底气。</p><div className="auth-feature"><BookOpen /><span>精选词书</span><span>·</span><Gear /><span>科学复习</span><span>·</span><Check /><span>临考速刷</span></div></div><span className="text-xs text-muted">Little by little, a little becomes a lot.</span></section>
  <section className="auth-form-area"><div className="auth-form"><Chip color="success" variant="soft" className="mb-5 w-fit">{register ? '新的旅程，从这里开始' : '很高兴，再次见到你'}</Chip><h2>{register ? '为进步，留一个位置' : '欢迎回到学习空间'}</h2><p>{register ? '创建账号，跨设备继续你的学习。' : '登录账号，接着上次的脚步往前走。'}</p>
    {alreadyRegistered ? <Card variant="secondary" className="mt-6 p-4"><Card.Header><Card.Title>当前已登录 {current?.name || '其他账号'}</Card.Title><Card.Description>创建另一个账号前，先退出当前账号。已有学习记录会保留。</Card.Description></Card.Header><Card.Footer><Button isPending={pending} onPress={() => { void logoutForRegistration() }}>退出并继续注册</Button></Card.Footer></Card> : <form onSubmit={submit} className="space-y-5 mt-7">
      {register && <TextField isRequired isDisabled={pending} isInvalid={touched && Boolean(nameError)}><Label>昵称</Label><Input name="name" value={fields.name} onChange={event => setFields(value => ({ ...value, name: event.target.value }))} autoComplete="nickname" placeholder="怎么称呼你" maxLength={80} />{touched && nameError && <p className="mt-2 text-xs text-danger">{nameError}</p>}</TextField>}
      <TextField isRequired isDisabled={pending}><Label>邮箱</Label><Input name="email" type="email" value={fields.email} onChange={event => setFields(value => ({ ...value, email: event.target.value }))} autoComplete="email" placeholder="you@example.com" /></TextField>
      <TextField isRequired isDisabled={pending} isInvalid={touched && Boolean(passwordError)}><Label>密码</Label><Input name="password" type="password" value={fields.password} onChange={event => setFields(value => ({ ...value, password: event.target.value }))} autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? '8–72 字节，建议使用字母与数字' : '输入你的密码'} aria-describedby="auth-password-help" /><p id="auth-password-help" className={`mt-2 text-xs ${touched && passwordError ? 'text-danger' : 'text-muted'}`}>{touched && passwordError ? passwordError : register ? '密码按 UTF-8 字节计数：英文字母和数字各占 1 字节，常见汉字占 3 字节。' : ''}</p></TextField>
      <Button fullWidth type="submit" isPending={pending}>{register ? '创建账号' : '登录'}<ArrowRight /></Button>
    </form>}
    {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
    <div className="auth-toggle"><span>{register ? '已有账号？' : '还没有账号？'}</span><Button size="sm" variant="ghost" isDisabled={pending} onPress={switchMode}>{register ? '去登录' : '免费注册'}</Button></div>{current?.guest && register && <p className="text-xs text-muted flex gap-2 leading-6"><ShieldCheck className="shrink-0 mt-1" />注册将保留你当前访客账号的学习进度。</p>}<Button fullWidth variant="ghost" className="mt-4" isDisabled={pending} onPress={() => navigate('/')}>{current && !current.guest ? '返回学习空间' : '先以访客身份学习'}</Button>
  </div></section></main>
}
