import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Card, Input, Label, Switch, TextField } from "@heroui/react";
import { Segment } from "@heroui-pro/react/segment";
import { toast } from "sonner";
import { queryClient, send, useUser, type User } from "../lib/api";
import { I, PageHeader } from "../components/shared";
import { errorText } from "../lib/utils";

export function Login() {
  const [params] = useSearchParams();
  const [register, setRegister] = useState(params.has("register"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const user = await send<User>(
        register ? "/auth/register" : "/auth/login",
        register ? { name, email, password } : { email, password },
      );
      queryClient.clear();
      queryClient.setQueryData(["me"], user);
      navigate(user.role === "admin" ? "/admin" : "/");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  async function guest() {
    setPending(true);
    setError("");
    try {
      const user = await send<User>("/auth/guest", {});
      queryClient.clear();
      queryClient.setQueryData(["me"], user);
      navigate("/");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-art">
        <div className="brand">
          <div className="brand-mark">
            <I name="book-open" />
          </div>
          <strong>就背单词</strong>
        </div>
        <div>
          <p className="eyebrow">Words become yours.</p>
          <h1>
            世界很大，
            <br />
            从一个单词开始。
          </h1>
          <p>
            按自己的节奏，让每一天的积累，
            <br />
            成为某一天的从容。
          </p>
        </div>
        <small>学习新词 · 间隔复习 · 临考速刷</small>
      </div>
      <div className="auth-form">
        <Card>
          <Card.Header>
            <h2>{register ? "给进步一个家" : "欢迎回来"}</h2>
            <p className="text-muted text-sm">
              {register
                ? "创建账户，保留当前访客的学习进度。"
                : "登录后，继续上一次的学习。"}
            </p>
          </Card.Header>
          <Card.Content>
            <Segment
              selectedKey={register ? "register" : "login"}
              onSelectionChange={(k) => {
                setRegister(k === "register");
                setError("");
              }}
              className="mb-6"
              aria-label="登录方式"
            >
              <Segment.Item id="login">登录</Segment.Item>
              <Segment.Item id="register">注册</Segment.Item>
            </Segment>
            <form onSubmit={submit} className="form-stack">
              {register && (
                <TextField isRequired>
                  <Label>昵称</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="nickname"
                    maxLength={50}
                    placeholder="怎么称呼你"
                  />
                </TextField>
              )}
              <TextField isRequired type="email">
                <Label>邮箱</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </TextField>
              <TextField isRequired type="password">
                <Label>密码</Label>
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={register ? "new-password" : "current-password"}
                  minLength={register ? 10 : 1}
                  maxLength={72}
                  placeholder={register ? "至少 10 位字符" : "输入密码"}
                />
              </TextField>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" fullWidth isPending={pending}>
                {register ? "创建账户" : "登录"}
                <I name="arrow-right" className="size-4" />
              </Button>
            </form>
          </Card.Content>
          <Card.Footer className="flex-col">
            <Button
              fullWidth
              variant="ghost"
              isDisabled={pending}
              onPress={guest}
            >
              先以访客体验
            </Button>
            <p className="text-muted text-xs mt-2">
              访客进度保存在当前浏览器会话，注册即可保留。
            </p>
          </Card.Footer>
        </Card>
      </div>
    </div>
  );
}
export function Settings() {
  const { data: user } = useUser();
  const [name, setName] = useState(""),
    [goal, setGoal] = useState(20),
    [exam, setExam] = useState(""),
    [saving, setSaving] = useState(false);
  const [auto, setAuto] = useState(
    localStorage.getItem("word-auto-audio") === "true",
  );
  const navigate = useNavigate();
  useEffect(() => {
    if (user) {
      setName(user.name);
      setGoal(user.dailyGoal);
      setExam(user.examDate || "");
    }
  }, [user]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const u = await send<User>(
        "/me",
        { name, dailyGoal: goal, examDate: exam },
        "PATCH",
      );
      queryClient.setQueryData(["me"], u);
      toast.success("学习计划已更新");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Make it your own"
        title="找到适合自己的节奏。"
        description="目标不必很大，适合自己、坚持下去就好。"
      />
      <div className="settings-grid">
        <Card>
          <Card.Header>
            <h2 className="font-semibold">学习计划</h2>
            <p className="text-muted text-sm">根据你的时间，设定每日目标。</p>
          </Card.Header>
          <Card.Content>
            <form className="form-stack" onSubmit={save}>
              <TextField isRequired>
                <Label>昵称</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={50}
                />
              </TextField>
              <TextField isRequired type="number">
                <Label>每日学习目标</Label>
                <Input
                  min={5}
                  max={500}
                  step={5}
                  value={goal}
                  onChange={(e) => setGoal(Number(e.target.value))}
                />
              </TextField>
              <TextField type="date">
                <Label>考试日期（可选）</Label>
                <Input value={exam} onChange={(e) => setExam(e.target.value)} />
              </TextField>
              <Button type="submit" isPending={saving}>
                保存计划
              </Button>
            </form>
          </Card.Content>
        </Card>
        <div className="flex flex-col gap-5">
          <Card>
            <Card.Header>
              <h2 className="font-semibold">学习偏好</h2>
            </Card.Header>
            <Card.Content>
              <div className="flex justify-between items-center gap-4">
                <div>
                  <strong className="text-sm">自动播放发音</strong>
                  <p className="text-muted text-xs mt-1">
                    进入下一个单词时，自动朗读。
                  </p>
                </div>
                <Switch
                  aria-label="自动播放发音"
                  isSelected={auto}
                  onChange={(v) => {
                    setAuto(v);
                    localStorage.setItem("word-auto-audio", String(v));
                  }}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Content>
                </Switch>
              </div>
            </Card.Content>
          </Card>
          <Card>
            <Card.Header>
              <h2 className="font-semibold">账户</h2>
            </Card.Header>
            <Card.Content>
              <p className="text-sm text-muted">
                {user?.guest
                  ? "当前以访客身份学习。注册后即可在其他设备登录，继续原来的进度。"
                  : `已登录：${user?.email}`}
              </p>
              {user?.guest && (
                <Button
                  variant="secondary"
                  className="mt-4"
                  onPress={() => navigate("/login?register=1")}
                >
                  注册并保留进度
                </Button>
              )}
            </Card.Content>
          </Card>
          <div className="settings-tip">
            <I name="circle-info" className="size-4" />
            <p>“会”不是终点。按时复习，才能让短暂印象变成长久记忆。</p>
          </div>
        </div>
      </div>
    </>
  );
}
