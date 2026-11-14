import { Button, Card, Chip } from "@heroui/react";
import { Widget } from "@heroui-pro/react/widget";
import { useNavigate } from "react-router-dom";
import { useBooks, useStats } from "../lib/api";
import {
  Empty,
  ErrorState,
  I,
  Loading,
  Metric,
  PageHeader,
} from "../components/shared";

export function Review() {
  const stats = useStats(),
    books = useBooks(),
    navigate = useNavigate();
  if (stats.error || books.error)
    return <ErrorState error={(stats.error || books.error)!} />;
  if (!stats.data || !books.data) return <Loading />;
  return (
    <>
      <PageHeader
        eyebrow="Make it stay"
        title="在遗忘之前，再见一面。"
        description="根据每次回答调整复习间隔，让记忆逐渐稳固。不会的词会在 10 分钟后重来。"
      />
      <div className="review-overview">
        <Card className="review-card">
          <Card.Content>
            <I name="arrows-rotate-right" className="text-accent size-7" />
            <h2>到期复习</h2>
            <strong>
              {stats.data.due}
              <small>词</small>
            </strong>
            <p>按记忆间隔安排，今天该见面的词。</p>
          </Card.Content>
        </Card>
        <Card className="review-card">
          <Card.Content>
            <I name="target" className="text-accent size-7" />
            <h2>重点巩固</h2>
            <strong>
              {stats.data.reinforce}
              <small>词</small>
            </strong>
            <p>速刷时犹豫过，值得再确认一次。</p>
          </Card.Content>
        </Card>
      </div>
      <div className="section-heading">
        <h2>按词书开始</h2>
        <span className="text-muted text-sm">
          新词 → 1 天 → 3 天 → 更长间隔
        </span>
      </div>
      <div className="review-book-list">
        {books.data.map((book) => (
          <Card key={book.id}>
            <Card.Content className="review-book-row">
              <div className="review-book-icon">
                <I name="book-open" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-sm">{book.title}</h3>
                <p className="text-muted text-xs mt-1">
                  已学 {book.learnedCount} 词 · {book.dueCount} 词待复习
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => navigate(`/study/${book.id}?mode=reinforce`)}
                >
                  巩固
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  isDisabled={!book.dueCount}
                  onPress={() => navigate(`/study/${book.id}?mode=review`)}
                >
                  复习 {book.dueCount ? book.dueCount : ""}
                </Button>
              </div>
            </Card.Content>
          </Card>
        ))}
      </div>
    </>
  );
}
export function Statistics() {
  const stats = useStats();
  if (stats.error) return <ErrorState error={stats.error} />;
  if (!stats.data) return <Loading />;
  const s = stats.data;
  return (
    <>
      <PageHeader
        eyebrow="Every word counts"
        title="每一点进步，都有迹可循。"
        description="真实记录每次学习与复习，看看自己的坚持。"
      />
      <div className="metrics-grid">
        <Metric
          title="累计已学"
          value={s.learned}
          icon="book-open"
          caption="已标记记住的单词"
        />
        <Metric
          title="今日学习"
          value={s.today}
          icon="circle-check"
          caption="今天提交的学习判断"
        />
        <Metric
          title="连续学习"
          value={s.streak}
          icon="flame"
          caption="天 · 继续保持"
        />
        <Metric
          title="待巩固"
          value={s.reinforce}
          icon="target"
          caption="来自临考速刷的犹豫词"
        />
      </div>
      <Widget>
        <Widget.Header>
          <Widget.Title>学习足迹</Widget.Title>
          <span className="text-xs text-muted">
            最近 {s.activity.length} 天
          </span>
        </Widget.Header>
        <Widget.Content>
          <div className="activity-grid">
            {s.activity.map((d) => (
              <div
                className="activity-cell"
                title={`${d.date}：${d.count} 次学习`}
                key={d.date}
                style={{
                  opacity: d.count ? Math.min(1, 0.35 + d.count / 30) : 1,
                }}
                data-active={d.count > 0}
              >
                <span>{d.date.slice(8)}</span>
                <strong>{d.count}</strong>
              </div>
            ))}
          </div>
          <p className="text-muted text-xs mt-4">
            统计按 UTC 日期归档，每一次回答都会留下足迹。
          </p>
        </Widget.Content>
      </Widget>
      <div className="section-heading">
        <h2>最近学过的词</h2>
      </div>
      {s.recent.length ? (
        <div className="recent-list">
          {s.recent.map((r, i) => (
            <div key={`${r.id}-${i}`} className="recent-row">
              <div>
                <strong>{r.text}</strong>
                <p>{r.meaning}</p>
              </div>
              <Chip
                size="sm"
                variant="soft"
                color={
                  r.answer === "known"
                    ? "success"
                    : r.answer === "unsure-known"
                      ? "warning"
                      : "default"
                }
              >
                {r.answer === "known"
                  ? "记住了"
                  : r.answer === "unsure-known"
                    ? "待巩固"
                    : "继续学习"}
              </Chip>
              <time>
                {new Date(r.createdAt).toLocaleString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title="第一条记录，等你来写"
          description="从一本词书开始，学习记录会在这里慢慢积累。"
        />
      )}
    </>
  );
}
