import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  Modal,
  Switch,
  TextArea,
  TextField,
} from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { DropZone } from "@heroui-pro/react/drop-zone";
import { NativeSelect } from "@heroui-pro/react/native-select";
import { Widget } from "@heroui-pro/react/widget";
import { LineChart } from "@heroui-pro/react/line-chart";
import { toast } from "sonner";
import {
  api,
  queryClient,
  send,
  useUser,
  type AdminStats,
  type Book,
  type Navigation,
  type User,
  type Word,
} from "../lib/api";
import {
  Empty,
  ErrorState,
  I,
  IconButton,
  Loading,
  Metric,
  PageHeader,
} from "../components/shared";
import { errorText } from "../lib/utils";

export function AdminGate({ children }: { children: ReactNode }) {
  const { data: user } = useUser();
  const location = useLocation();
  const nav = useQuery({
    queryKey: ["navigation"],
    queryFn: () => api<Navigation[]>("/admin/navigation"),
    enabled: user?.role === "admin",
    refetchInterval: 30_000,
  });
  if (user?.role !== "admin")
    return (
      <Empty
        title="需要管理员账户"
        description="使用部署时配置的管理员邮箱和密码登录。"
        icon="lock"
      >
        <Button onPress={() => window.location.assign("/login")}>
          管理员登录
        </Button>
      </Empty>
    );
  if (nav.error) return <ErrorState error={nav.error} />;
  if (!nav.data) return <Loading />;
  const module = location.pathname.startsWith("/admin/books/")
    ? "/admin/books"
    : location.pathname;
  const available = nav.data.find((n) => n.path === module && n.enabled);
  if (!available && module !== "/admin/navigation")
    return (
      <Empty
        title="这个管理模块已停用"
        description="可以在导航配置中重新启用。"
      >
        <Button onPress={() => window.location.assign("/admin/navigation")}>
          导航配置
        </Button>
      </Empty>
    );
  return children;
}
export function AdminOverview() {
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api<AdminStats>("/admin/stats"),
    refetchInterval: 30_000,
  });
  if (stats.error) return <ErrorState error={stats.error} />;
  if (!stats.data) return <Loading />;
  const s = stats.data;
  return (
    <>
      <PageHeader
        eyebrow="Site overview"
        title="站点概览"
        description="查看词库与学习活动，数据每 30 秒自动更新。"
        action={
          <Chip variant="soft" color="success">
            <span className="status-dot" />
            实时数据
          </Chip>
        }
      />
      <div className="metrics-grid">
        <Metric
          title="学习用户"
          value={s.users}
          icon="persons"
          caption={`今日活跃 ${s.activeToday} 人`}
        />
        <Metric
          title="已上架词书"
          value={s.books}
          icon="book-open"
          caption="可供用户选择学习"
        />
        <Metric
          title="词库总量"
          value={s.words}
          icon="stack"
          caption="所有词书中的词条"
        />
        <Metric
          title="累计学习"
          value={s.answers}
          icon="chart-column"
          caption="实际提交的学习判断"
        />
      </div>
      <Widget>
        <Widget.Header>
          <Widget.Title>学习活动趋势</Widget.Title>
          <span className="text-muted text-xs">按 UTC 日期统计</span>
        </Widget.Header>
        <Widget.Content>
          <LineChart data={s.activity} height={260}>
            <LineChart.Grid vertical={false} />
            <LineChart.XAxis
              dataKey="date"
              tickFormatter={(v: string) => v.slice(5)}
              tickMargin={10}
            />
            <LineChart.YAxis allowDecimals={false} width={35} />
            <LineChart.Line
              dataKey="count"
              name="学习次数"
              stroke="var(--accent)"
              strokeWidth={2.5}
              dot={false}
              type="monotone"
            />
            <LineChart.Tooltip />
          </LineChart>
        </Widget.Content>
      </Widget>
      <div className="section-heading">
        <h2>最近学习动态</h2>
      </div>
      {s.recent.length ? (
        <DataGrid
          aria-label="最近学习动态"
          data={s.recent.map((r, i) => ({ ...r, rowId: i }))}
          getRowId={(r) => r.rowId}
          columns={[
            {
              id: "text",
              header: "单词",
              accessorKey: "text",
              isRowHeader: true,
            },
            { id: "meaning", header: "释义", accessorKey: "meaning" },
            {
              id: "answer",
              header: "学习结果",
              cell: (r) => (
                <Chip
                  size="sm"
                  variant="soft"
                  color={r.answer === "known" ? "success" : "default"}
                >
                  {r.answer === "known"
                    ? "记住了"
                    : r.answer === "unsure-known"
                      ? "加入巩固"
                      : "继续学习"}
                </Chip>
              ),
            },
            {
              id: "time",
              header: "时间",
              cell: (r) => new Date(r.createdAt).toLocaleString("zh-CN"),
            },
          ]}
          contentClassName="min-w-[650px]"
        />
      ) : (
        <Empty
          title="暂时还没有学习活动"
          description="用户开始学习后，记录会显示在这里。"
        />
      )}
    </>
  );
}
const newBook = {
  title: "",
  subtitle: "",
  description: "",
  category: "自定义",
  color: "violet",
};
export function AdminBooks() {
  const books = useQuery({
    queryKey: ["admin-books"],
    queryFn: () => api<Book[]>("/admin/books"),
  });
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Book | null | undefined>(undefined);
  const [form, setForm] = useState(newBook);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Book | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (editing !== undefined)
      setForm(
        editing
          ? {
              title: editing.title,
              subtitle: editing.subtitle,
              description: editing.description,
              category: editing.category,
              color: editing.color,
            }
          : newBook,
      );
  }, [editing]);
  async function refresh() {
    await Promise.all(
      ["admin-books", "books", "admin-stats"].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      ),
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await send(
        editing ? `/admin/books/${editing.id}` : "/admin/books",
        form,
        editing ? "PATCH" : "POST",
      );
      setEditing(undefined);
      await refresh();
      toast.success("词书已保存");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setSaving(true);
    try {
      await api(`/admin/books/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      await refresh();
      toast.success("词书已删除");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  const columns: DataGridColumn<Book>[] = [
    {
      id: "title",
      header: "词书",
      accessorKey: "title",
      isRowHeader: true,
      allowsSorting: true,
      cell: (b) => (
        <div className="flex items-center gap-3">
          <span className="admin-book-icon">
            <I name="book-open" />
          </span>
          <div>
            <strong className="font-medium">{b.title}</strong>
            <p className="text-muted text-xs mt-1">{b.subtitle}</p>
          </div>
        </div>
      ),
      minWidth: 240,
    },
    {
      id: "category",
      header: "分类",
      accessorKey: "category",
      allowsSorting: true,
      cell: (b) => (
        <Chip size="sm" variant="soft">
          {b.category}
        </Chip>
      ),
    },
    {
      id: "words",
      header: "词条",
      accessorKey: "wordCount",
      allowsSorting: true,
      cellClassName: "tabular-nums",
    },
    {
      id: "actions",
      header: "操作",
      align: "end",
      cell: (b) => (
        <div className="flex gap-2 justify-end">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => navigate(`/admin/books/${b.id}`)}
          >
            管理词条
          </Button>
          <IconButton
            label={`编辑${b.title}`}
            icon="pencil"
            onPress={() => setEditing(b)}
          />
          <IconButton
            label={`删除${b.title}`}
            icon="trash-bin"
            onPress={() => setDeleting(b)}
          />
        </div>
      ),
      minWidth: 200,
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="Content management"
        title="词书管理"
        description="创建词书、维护词条，或批量导入自己的词库。"
        action={
          <Button onPress={() => setEditing(null)}>
            <I name="plus" className="size-4" />
            新建词书
          </Button>
        }
      />
      <div className="admin-toolbar">
        <Input
          aria-label="搜索管理词书"
          placeholder="搜索词书名称…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-80"
        />
        <span className="text-muted text-xs">
          {books.data?.length || 0} 本词书
        </span>
      </div>
      {books.error ? (
        <ErrorState error={books.error} />
      ) : !books.data ? (
        <Loading />
      ) : (
        <DataGrid
          aria-label="词书管理表格"
          data={books.data.filter((b) =>
            b.title.toLowerCase().includes(search.toLowerCase()),
          )}
          columns={columns}
          getRowId={(b) => b.id}
          contentClassName="min-w-[700px]"
          renderEmptyState={() => (
            <Empty
              title="还没有词书"
              description="创建一本词书，再导入词条。"
            />
          )}
        />
      )}
      <Modal.Backdrop
        isOpen={editing !== undefined}
        onOpenChange={(v) => {
          if (!v && !saving) setEditing(undefined);
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{editing ? "编辑词书" : "新建词书"}</Modal.Heading>
            </Modal.Header>
            <form onSubmit={save}>
              <Modal.Body className="form-stack">
                <TextField isRequired>
                  <Label>词书名称</Label>
                  <Input
                    maxLength={100}
                    value={form.title}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                  />
                </TextField>
                <div className="form-two-columns">
                  <TextField>
                    <Label>封面简称</Label>
                    <Input
                      placeholder="例如 CET4"
                      maxLength={50}
                      value={form.subtitle}
                      onChange={(e) =>
                        setForm({ ...form, subtitle: e.target.value })
                      }
                    />
                  </TextField>
                  <TextField isRequired>
                    <Label>分类</Label>
                    <Input
                      maxLength={40}
                      value={form.category}
                      onChange={(e) =>
                        setForm({ ...form, category: e.target.value })
                      }
                    />
                  </TextField>
                </div>
                <TextField>
                  <Label>简介</Label>
                  <TextArea
                    rows={3}
                    maxLength={1000}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </TextField>
                <div>
                  <Label>封面颜色</Label>
                  <NativeSelect className="mt-2">
                    <NativeSelect.Trigger
                      aria-label="封面颜色"
                      value={form.color}
                      onChange={(e) =>
                        setForm({ ...form, color: e.target.value })
                      }
                    >
                      {[
                        "violet",
                        "blue",
                        "green",
                        "orange",
                        "rose",
                        "teal",
                      ].map((c, i) => (
                        <NativeSelect.Option value={c} key={c}>
                          {
                            ["紫色", "蓝色", "绿色", "橙色", "玫瑰色", "青色"][
                              i
                            ]
                          }
                        </NativeSelect.Option>
                      ))}
                      <NativeSelect.Indicator />
                    </NativeSelect.Trigger>
                  </NativeSelect>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  isDisabled={saving}
                  onPress={() => setEditing(undefined)}
                >
                  取消
                </Button>
                <Button type="submit" isPending={saving}>
                  保存词书
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <Confirm
        open={!!deleting}
        title="删除这本词书？"
        description={`「${deleting?.title}」的词条及关联学习进度也会删除。此操作无法撤销。`}
        pending={saving}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </>
  );
}
function Confirm({
  open,
  title,
  description,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(v) => {
        if (!v && !pending) onClose();
      }}
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-md">
          <Modal.Header>
            <Modal.Heading>{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p className="text-muted text-sm leading-7">{description}</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={onClose} isDisabled={pending}>
              取消
            </Button>
            <Button
              variant="danger-soft"
              onPress={onConfirm}
              isPending={pending}
            >
              确认删除
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
const blankWord = {
  text: "",
  phonetic: "",
  meaning: "",
  example: "",
  exampleMeaning: "",
};
export function AdminBookWords() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useQuery({
    queryKey: ["book", id],
    queryFn: () => api<{ book: Book; words: Word[] }>(`/books/${id}`),
  });
  const [search, setSearch] = useState(""),
    [importing, setImporting] = useState(false),
    [json, setJson] = useState(""),
    [saving, setSaving] = useState(false),
    [form, setForm] = useState(blankWord),
    [editing, setEditing] = useState(false),
    [deleting, setDeleting] = useState<Word | null>(null),
    [filename, setFilename] = useState("");
  async function refresh() {
    await Promise.all(
      ["book", "books", "admin-books", "admin-stats"].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      ),
    );
  }
  async function readFile(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("文件不能超过 5 MB");
      return;
    }
    try {
      setJson(await file.text());
      setFilename(file.name);
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  async function importWords(words: unknown) {
    if (!Array.isArray(words) || words.length === 0 || words.length > 5000) {
      toast.error("请提供包含 1 至 5000 个词条的数组");
      return;
    }
    setSaving(true);
    try {
      const result = await send<{ imported: number }>(
        `/admin/books/${id}/words`,
        { words },
      );
      await refresh();
      setImporting(false);
      setEditing(false);
      setJson("");
      setFilename("");
      toast.success(`已保存 ${result.imported} 个词条`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  function submitJSON() {
    try {
      const parsed = JSON.parse(json);
      void importWords(Array.isArray(parsed) ? parsed : parsed.words);
    } catch {
      toast.error("JSON 格式不正确，请检查括号和逗号");
    }
  }
  async function remove() {
    if (!deleting) return;
    setSaving(true);
    try {
      await api(`/admin/words/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      await refresh();
      toast.success("词条已删除");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  if (data.error) return <ErrorState error={data.error} />;
  if (!data.data) return <Loading />;
  const { book, words } = data.data;
  const columns: DataGridColumn<Word>[] = [
    {
      id: "text",
      header: "单词",
      accessorKey: "text",
      isRowHeader: true,
      allowsSorting: true,
      cell: (w) => (
        <div>
          <strong className="font-medium text-base">{w.text}</strong>
          <p className="text-muted text-xs mt-1">{w.phonetic}</p>
        </div>
      ),
    },
    { id: "meaning", header: "释义", accessorKey: "meaning", minWidth: 200 },
    {
      id: "example",
      header: "例句",
      accessorKey: "example",
      minWidth: 260,
      cell: (w) => (
        <div className="max-w-sm text-xs leading-6">
          <p>{w.example}</p>
          <p className="text-muted">{w.exampleMeaning}</p>
        </div>
      ),
    },
    {
      id: "actions",
      header: "操作",
      align: "end",
      cell: (w) => (
        <div className="flex justify-end">
          <IconButton
            label={`编辑 ${w.text}`}
            icon="pencil"
            onPress={() => {
              setForm(w);
              setEditing(true);
            }}
          />
          <IconButton
            label={`删除 ${w.text}`}
            icon="trash-bin"
            onPress={() => setDeleting(w)}
          />
        </div>
      ),
    },
  ];
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="mb-5"
        onPress={() => navigate("/admin/books")}
      >
        <I name="arrow-left" className="size-4" />
        返回词书管理
      </Button>
      <PageHeader
        title={book.title}
        description={`${words.length} 个词条 · 同一本词书内按单词文本更新已有词条。`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onPress={() => setImporting(true)}>
              <I name="arrow-up-from-line" className="size-4" />
              导入 JSON
            </Button>
            <Button
              onPress={() => {
                setForm(blankWord);
                setEditing(true);
              }}
            >
              添加词条
            </Button>
          </div>
        }
      />
      <Input
        className="max-w-80 mb-5"
        aria-label="搜索管理词条"
        placeholder="搜索单词或释义"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <DataGrid
        aria-label="词条管理表格"
        data={words.filter((w) =>
          `${w.text} ${w.meaning}`.toLowerCase().includes(search.toLowerCase()),
        )}
        columns={columns}
        getRowId={(w) => w.id}
        contentClassName="min-w-[780px]"
        scrollContainerClassName="max-h-[650px] overflow-y-auto"
        stickyHeader
      />
      <Modal.Backdrop
        isOpen={editing}
        onOpenChange={(v) => {
          if (!saving) setEditing(v);
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>保存词条</Modal.Heading>
            </Modal.Header>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void importWords([form]);
              }}
            >
              <Modal.Body className="form-stack">
                {Object.entries({
                  text: "单词",
                  phonetic: "音标",
                  meaning: "中文释义",
                  example: "英文例句",
                  exampleMeaning: "例句翻译",
                }).map(([key, label]) => (
                  <TextField
                    key={key}
                    isRequired={key === "text" || key === "meaning"}
                  >
                    <Label>{label}</Label>
                    <Input
                      maxLength={key === "text" ? 100 : 2000}
                      value={form[key as keyof typeof blankWord]}
                      onChange={(e) =>
                        setForm({ ...form, [key]: e.target.value })
                      }
                    />
                  </TextField>
                ))}
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  onPress={() => setEditing(false)}
                  isDisabled={saving}
                >
                  取消
                </Button>
                <Button type="submit" isPending={saving}>
                  保存词条
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <Modal.Backdrop
        isOpen={importing}
        onOpenChange={(v) => {
          if (!saving) setImporting(v);
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-xl">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>批量导入词条</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="form-stack">
              <p className="text-muted text-xs leading-6">
                上传 JSON 文件或粘贴数组。必填 text、meaning，可选
                phonetic、example、exampleMeaning。每次最多 5000
                词，全部校验通过后统一保存。
              </p>
              <DropZone>
                <DropZone.Area
                  onDrop={async (e) => {
                    for (const item of e.items) {
                      if (item.kind === "file") {
                        await readFile(await item.getFile());
                        break;
                      }
                    }
                  }}
                >
                  <DropZone.Icon />
                  <DropZone.Label>
                    {filename || "拖放 JSON 文件到这里"}
                  </DropZone.Label>
                  <DropZone.Description>最大 5 MB</DropZone.Description>
                  <DropZone.Trigger>选择文件</DropZone.Trigger>
                </DropZone.Area>
                <DropZone.Input
                  accept="application/json,.json"
                  onSelect={(files) => void readFile(files?.[0])}
                />
              </DropZone>
              <TextArea
                aria-label="词条 JSON"
                className="font-mono text-xs min-h-40"
                value={json}
                onChange={(e) => setJson(e.target.value)}
                placeholder={
                  '[{"text":"serendipity","meaning":"n. 意外的幸运","phonetic":"/ˌserənˈdɪpəti/"}]'
                }
              />
              <Button
                variant="ghost"
                size="sm"
                onPress={() => {
                  const a = document.createElement("a");
                  const url = URL.createObjectURL(
                    new Blob(
                      [
                        JSON.stringify(
                          [
                            {
                              text: "serendipity",
                              phonetic: "/ˌserənˈdɪpəti/",
                              meaning: "n. 意外的幸运",
                              example:
                                "Finding this book was pure serendipity.",
                              exampleMeaning: "找到这本书纯属意外之喜。",
                            },
                          ],
                          null,
                          2,
                        ),
                      ],
                      { type: "application/json" },
                    ),
                  );
                  a.href = url;
                  a.download = "word-import-example.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                下载示例文件
              </Button>
            </Modal.Body>
            <Modal.Footer>
              <Button
                variant="ghost"
                onPress={() => setImporting(false)}
                isDisabled={saving}
              >
                取消
              </Button>
              <Button
                onPress={submitJSON}
                isPending={saving}
                isDisabled={!json.trim()}
              >
                校验并导入
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <Confirm
        open={!!deleting}
        title={`删除 ${deleting?.text}？`}
        description="关联的学习进度与收藏也会移除。"
        pending={saving}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </>
  );
}
type AdminUser = User & { learnedCount: number; createdAt: string };
export function AdminUsers() {
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api<AdminUser[]>("/admin/users"),
  });
  const [search, setSearch] = useState("");
  return (
    <>
      <PageHeader
        eyebrow="Learners"
        title="用户与学习进度"
        description="了解站点的学习者，查看账户类型和已学词量。"
      />
      <Input
        className="max-w-80 mb-5"
        aria-label="搜索用户"
        placeholder="搜索昵称或邮箱"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {users.error ? (
        <ErrorState error={users.error} />
      ) : !users.data ? (
        <Loading />
      ) : (
        <DataGrid
          aria-label="用户管理表格"
          data={users.data.filter((u) =>
            `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()),
          )}
          getRowId={(u) => u.id}
          contentClassName="min-w-[700px]"
          columns={[
            {
              id: "name",
              header: "用户",
              accessorKey: "name",
              isRowHeader: true,
              allowsSorting: true,
              cell: (u) => (
                <div>
                  <strong className="font-medium">{u.name}</strong>
                  <p className="text-xs text-muted mt-1">
                    {u.email || "访客账户"}
                  </p>
                </div>
              ),
            },
            {
              id: "role",
              header: "身份",
              cell: (u) => (
                <Chip
                  size="sm"
                  variant="soft"
                  color={u.role === "admin" ? "accent" : "default"}
                >
                  {u.role === "admin"
                    ? "管理员"
                    : u.guest
                      ? "访客"
                      : "注册用户"}
                </Chip>
              ),
            },
            {
              id: "learned",
              header: "已学词量",
              accessorKey: "learnedCount",
              allowsSorting: true,
              cellClassName: "tabular-nums",
            },
            {
              id: "goal",
              header: "每日目标",
              accessorKey: "dailyGoal",
              cellClassName: "tabular-nums",
            },
            {
              id: "created",
              header: "加入时间",
              cell: (u) => new Date(u.createdAt).toLocaleDateString("zh-CN"),
            },
          ]}
        />
      )}
    </>
  );
}
export function AdminNavigation() {
  const nav = useQuery({
    queryKey: ["navigation"],
    queryFn: () => api<Navigation[]>("/admin/navigation"),
  });
  const [items, setItems] = useState<Navigation[]>([]),
    [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (nav.data && !dirty)
      setItems([...nav.data].sort((a, b) => a.sortOrder - b.sortOrder));
  }, [nav.data, dirty]);
  function change(index: number, patch: Partial<Navigation>) {
    setDirty(true);
    setItems((v) =>
      v.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  function move(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    setDirty(true);
    setItems((v) => {
      const copy = [...v];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }
  async function save() {
    setSaving(true);
    try {
      const result = await send<Navigation[]>(
        "/admin/navigation",
        { items: items.map((item, i) => ({ ...item, sortOrder: i })) },
        "PUT",
      );
      setDirty(false);
      queryClient.setQueryData(["navigation"], result);
      toast.success("导航已更新，侧栏与路由同步生效");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Dynamic navigation"
        title="后台导航配置"
        description="调整显示名称、排序和模块开关。保存后侧栏与可访问页面立即同步。"
        action={
          <Button onPress={save} isPending={saving} isDisabled={!dirty}>
            保存配置
          </Button>
        }
      />
      {nav.error ? (
        <ErrorState error={nav.error} />
      ) : !nav.data ? (
        <Loading />
      ) : (
        <div className="navigation-editor">
          {items.map((item, index) => (
            <Card key={item.id}>
              <Card.Content className="navigation-row">
                <span className="nav-order">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="nav-label">
                  <Input
                    aria-label={`${item.path} 显示名称`}
                    value={item.label}
                    maxLength={40}
                    onChange={(e) => change(index, { label: e.target.value })}
                  />
                  <code>{item.path}</code>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton
                    label={`上移${item.label}`}
                    icon="arrow-up"
                    disabled={index === 0}
                    onPress={() => move(index, -1)}
                  />
                  <IconButton
                    label={`下移${item.label}`}
                    icon="arrow-down"
                    disabled={index === items.length - 1}
                    onPress={() => move(index, 1)}
                  />
                </div>
                <Switch
                  aria-label={`启用${item.label}`}
                  isSelected={item.enabled}
                  isDisabled={item.path === "/admin/navigation"}
                  onChange={(v) => change(index, { enabled: v })}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Content>
                </Switch>
              </Card.Content>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-muted mt-5 leading-6">
        导航配置模块保持可用，以便随时恢复其他模块。刷新页面后配置仍会保留。
      </p>
    </>
  );
}
