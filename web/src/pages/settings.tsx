import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Input, Label, Switch, TextField } from '@heroui/react'
import { NumberStepper } from '@heroui-pro/react/number-stepper'
import { Segment } from '@heroui-pro/react'
import { ArrowRight, BookOpen, Check, Gear, ShieldCheck, Volume } from '@gravity-ui/icons'
import { toast } from 'sonner'
import { api, json, useUser } from '@/lib/api'
import { pronounce } from '@/lib/speech'
import type { User } from '@/lib/types'
import { Failure, Loading, PageHeading } from '@/components/shared'

export function SettingsPage() {
  const { data: user } = useUser()
  return user ? <SettingsForm key={user.id} user={user} /> : null
}
function SettingsForm({ user }: { user: User }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState(user.name)
  const [goal, setGoal] = useState(user.dailyGoal)
  const [exam, setExam] = useState(user.examDate?.slice(0,10) || '')
  const [pending, setPending] = useState(false)
  const [autoAudio, setAutoAudio] = useState(localStorage.getItem('word-auto-audio') === 'true')
  const [accent, setAccent] = useState(localStorage.getItem('word-accent') || 'en-US')
  const save = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); setPending(true)
    try { const result = await api<User>('/me', json('PATCH', { name, dailyGoal: goal, examDate: exam })); client.setQueryData(['me'], result); toast.success('学习计划已保存') }
    catch (e) { toast.error((e as Error).message) } finally { setPending(false) }
  }
  return <div className="page-stack settings-page"><PageHeading eyebrow="按照自己的节奏" title="让学习，更适合你" description="小一点的目标，坚持久一点。找到你舒服的学习方式。" /><form onSubmit={save}><Card><Card.Header><Card.Title>学习计划</Card.Title><Card.Description>每天迈出一小步，就足够好。</Card.Description></Card.Header><Card.Content className="space-y-7"><TextField isRequired><Label>怎么称呼你</Label><Input variant="secondary" value={name} onChange={event => setName(event.target.value)} maxLength={60} /></TextField><div className="settings-row"><div><h3>每日新词目标</h3><p>每次常规学习最多加载这些新词</p></div><NumberStepper aria-label="每日新词目标" value={goal} onChange={setGoal} minValue={5} maxValue={200} step={5}><NumberStepper.Group><NumberStepper.DecrementButton aria-label="减少目标" /><NumberStepper.Value /><NumberStepper.IncrementButton aria-label="增加目标" /></NumberStepper.Group></NumberStepper></div><TextField><Label>目标考试日期（选填）</Label><Input type="date" variant="secondary" value={exam} onChange={event => setExam(event.target.value)} /><p className="text-xs text-muted mt-2">用一个明确的日子，给努力一个方向。</p></TextField></Card.Content><Card.Footer><Button type="submit" isPending={pending}>保存计划 <Check /></Button></Card.Footer></Card></form><Card><Card.Header><Card.Title>发音偏好</Card.Title></Card.Header><Card.Content className="space-y-6"><div className="settings-row"><div><h3>英语口音</h3><p>使用设备上可用的英语语音</p></div><Segment aria-label="英语口音" selectedKey={accent} onSelectionChange={key => { const value = String(key); setAccent(value); localStorage.setItem('word-accent', value) }}><Segment.Item id="en-US">美式</Segment.Item><Segment.Item id="en-GB">英式</Segment.Item></Segment></div><div className="settings-row"><div><h3>自动发音</h3><p>切换单词时自动朗读</p></div><Switch aria-label="自动发音" isSelected={autoAudio} onChange={selected => { setAutoAudio(selected); localStorage.setItem('word-auto-audio', String(selected)) }}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch></div><Button variant="outline" onPress={() => pronounce('possibility', accent)}><Volume />试听发音</Button></Card.Content></Card><Card><Card.Header><Card.Title>我的账号</Card.Title></Card.Header><Card.Content className="settings-row"><div><h3>{user.name} <Chip size="sm" variant="soft">{user.guest ? '访客' : user.role === 'admin' ? '管理员' : '学习者'}</Chip></h3><p>{user.guest ? '访客进度保存在当前浏览器会话，注册后可跨设备登录。' : user.email}</p></div><Button variant="outline" onPress={() => navigate('/login')}>{user.guest ? '注册保留进度' : '切换账号'}</Button></Card.Content></Card></div>
}

export function LoginPage() {
  const [params] = useSearchParams()
  const [register, setRegister] = useState(params.get('mode') === 'register')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const client = useQueryClient()
  const currentQuery = useUser()
  const current = currentQuery.data
  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!current || currentQuery.isPending) return
    const form = new FormData(event.currentTarget)
    setPending(true); setError('')
    try {
      const result = await api<User>(register ? '/auth/register' : '/auth/login', json('POST', { ...(register ? { name: form.get('name') } : {}), email: form.get('email'), password: form.get('password') }))
      client.clear(); client.setQueryData(['me'], result)
      toast.success(register ? '账号已创建，学习进度已保留' : '欢迎回来')
      navigate(result.role === 'admin' ? '/admin' : '/')
    } catch (e) { setError((e as Error).message) } finally { setPending(false) }
  }
  if (currentQuery.isPending) return <Loading label="正在准备账号会话" />
  if (currentQuery.error || !current) return <Failure error={currentQuery.error} retry={currentQuery.refetch} />
  return <main className="auth-page"><section className="auth-story"><a href="/" onClick={event => { event.preventDefault(); navigate('/') }} className="brand"><img src="/favicon.svg" alt="" /><span>就背单词</span></a><div><p className="eyebrow">记住单词，也记住每天的进步</p><h1>一个词，<br />一个更大的世界。</h1><p>每天的一点点，终会成为你向前的底气。</p><div className="auth-feature"><BookOpen /><span>精选词书</span><span>·</span><Gear /><span>科学复习</span><span>·</span><Check /><span>临考速刷</span></div></div><span className="text-xs text-muted">Little by little, a little becomes a lot.</span></section><section className="auth-form-area"><div className="auth-form"><Chip color="success" variant="soft" className="mb-5 w-fit">{register ? '新的旅程，从这里开始' : '很高兴，再次见到你'}</Chip><h2>{register ? '为进步，留一个位置' : '欢迎回到学习空间'}</h2><p>{register ? '创建账号，跨设备继续你的学习。' : '登录账号，接着上次的脚步往前走。'}</p><form onSubmit={submit} className="space-y-5 mt-7">{register && <TextField isRequired><Label>昵称</Label><Input name="name" autoComplete="nickname" placeholder="怎么称呼你" maxLength={60} /></TextField>}<TextField isRequired><Label>邮箱</Label><Input name="email" type="email" autoComplete="email" placeholder="you@example.com" /></TextField><TextField isRequired><Label>密码</Label><Input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : 1} maxLength={72} placeholder={register ? '至少 8 位字符' : '输入你的密码'} /></TextField>{error && <p className="text-sm text-danger" role="alert">{error}</p>}<Button fullWidth type="submit" isPending={pending}>{register ? '创建账号' : '登录'}<ArrowRight /></Button></form><div className="auth-toggle"><span>{register ? '已有账号？' : '还没有账号？'}</span><Button size="sm" variant="ghost" onPress={() => { setRegister(!register); setError('') }}>{register ? '去登录' : '免费注册'}</Button></div>{current?.guest && register && <p className="text-xs text-muted flex gap-2 leading-6"><ShieldCheck className="shrink-0 mt-1" />注册将保留你当前访客账号的学习进度。</p>}<Button fullWidth variant="ghost" className="mt-4" onPress={() => navigate('/')}>先以访客身份学习</Button></div></section></main>
}
