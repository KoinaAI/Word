import { Button, Card, Chip } from "@heroui/react";
import { Widget } from "@heroui-pro/react/widget";
import { useNavigate } from "react-router-dom";
import { useBooks, useStats, useUser } from "../lib/api";
import {
  BookCard,
  BookCover,
  Empty,
  ErrorState,
  I,
  Loading,
  Metric,
  PageHeader,
  Progress,
} from "../components/shared";

export function Home() {
  const { data: user } = useUser();
  const stats = useStats();
  const books = useBooks();
  const navigate = useNavigate();
  if (stats.error || books.error)
    return (
      <ErrorState
        error={(stats.error || books.error)!}
        retry={() => {
          void stats.refetch();
          void books.refetch();
        }}
      />
    );
  if (!stats.data || !books.data) return <Loading />;
  const s = stats.data,
    active =
      books.data.find((b) => b.id === user?.activeBookId) || books.data[0];
  const percent = Math.min(
    100,
    Math.round((s.today / (user?.dailyGoal || 20)) * 100),
  );
  return (
    <>
      <PageHeader
        eyebrow="A little every day"
        title={`你好，${user?.guest ? "学习者" : user?.name || "学习者"}。今天也向前一步。`}
        description="记住一个词，就多一种表达世界的方式。"
        action={
          <Chip variant="soft" color="accent">
            <I name="flame" className="size-4" />
            连续学习 {s.streak} 天
          </Chip>
        }
      />
      <section className="dashboard-top">
        <Card className="daily-card">
          <Card.Content>
            <div className="daily-copy">
              <div className="pill-label">
                <span />
                今日学习计划
              </div>
              <h2>
                {s.today >= (user?.dailyGoal || 20) ? (
                  "今天的目标，已达成。"
                ) : (
                  <>
                    给未来的自己，
                    <br />
                    多一点词汇底气。
                  </>
                )}
              </h2>
              <p>每天一点点，把陌生变成脱口而出。</p>
              <div className="daily-progress">
                <div>
                  <span>今日已学习</span>
                  <strong>
                    {s.today}
                    <small> / {user?.dailyGoal || 20} 词</small>
                  </strong>
                </div>
                <Progress value={percent} label="今日目标完成度" />
              </div>
              <div className="flex gap-3 mt-6 flex-wrap">
                <Button
                  onPress={() =>
                    navigate(
                      active ? `/study/${active.id}?mode=learn` : "/books",
                    )
                  }
                >
                  开始学习
                  <I name="arrow-right" className="size-4" />
                </Button>
                <Button variant="ghost" onPress={() => navigate("/review")}>
                  复习到期单词
                </Button>
              </div>
            </div>
            <div className="daily-art" aria-hidden="true">
              <div className="art-orbit orbit-one" />
              <div className="art-orbit orbit-two" />
              <div className="art-card art-back">
                <span>Aa</span>
              </div>
              <div className="art-card art-front">
                <span className="art-word">Grow.</span>
                <small>/ɡrəʊ/</small>
                <div className="art-line" />
                <p>让成长，每天发生。</p>
                <div className="art-check">
                  <I name="check" />
                </div>
              </div>
              <span className="art-star star-one">✦</span>
              <span className="art-star star-two">✧</span>
            </div>
          </Card.Content>
        </Card>
        <Card className="sprint-callout">
          <Card.Content>
            <div className="sprint-icon">
              <I name="bolt" />
            </div>
            <Chip size="sm" variant="soft">
              考前冲刺
            </Chip>
            <h2>
              时间不多？
              <br />
              只刷真正不会的。
            </h2>
            <p>
              会的直接跳过，犹豫的单独巩固。
              <br />
              把时间留给最值得记的词。
            </p>
            <Button
              variant="secondary"
              className="mt-5"
              onPress={() => navigate("/sprint")}
            >
              进入临考速刷
              <I name="arrow-up-right" className="size-4" />
            </Button>
          </Card.Content>
        </Card>
      </section>
      <div className="metrics-grid">
        <Metric
          title="累计已学"
          value={s.learned}
          icon="book-open"
          caption="每一次记住，都算数"
        />
        <Metric
          title="待复习"
          value={s.due}
          icon="arrows-rotate-right"
          caption="趁遗忘之前，再见一面"
        />
        <Metric
          title="待巩固"
          value={s.reinforce}
          icon="target"
          caption="把模糊的记忆变清晰"
        />
        <Metric
          title="我的收藏"
          value={s.favorites}
          icon="bookmark"
          caption="留住值得反复琢磨的词"
        />
      </div>
      <section className="home-middle">
        <Widget>
          <Widget.Header>
            <Widget.Title>正在学习</Widget.Title>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => navigate("/books")}
            >
              切换词书
              <I name="arrow-right" className="size-4" />
            </Button>
          </Widget.Header>
          <Widget.Content>
            {active ? (
              <div className="active-book">
                <BookCover book={active} />
                <div className="min-w-0 flex-1">
                  <span className="eyebrow">Your current book</span>
                  <h3 className="font-semibold mt-2">{active.title}</h3>
                  <p className="text-muted text-sm mt-2">
                    {active.description}
                  </p>
                  <div className="mt-5 flex justify-between text-xs text-muted mb-2">
                    <span>
                      {active.learnedCount} / {active.wordCount} 词
                    </span>
                    <span>
                      {active.wordCount
                        ? Math.round(
                            (active.learnedCount / active.wordCount) * 100,
                          )
                        : 0}
                      %
                    </span>
                  </div>
                  <Progress
                    value={
                      active.wordCount
                        ? (active.learnedCount / active.wordCount) * 100
                        : 0
                    }
                    label="当前词书进度"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onPress={() => navigate(`/books/${active.id}`)}
                  >
                    继续这本词书
                  </Button>
                </div>
              </div>
            ) : (
              <Empty
                title="选择第一本词书"
                description="从感兴趣的主题开始。"
              />
            )}
          </Widget.Content>
        </Widget>
        <Widget>
          <Widget.Header>
            <Widget.Title>最近 7 天</Widget.Title>
            <span className="text-xs text-muted">学习次数</span>
          </Widget.Header>
          <Widget.Content>
            <div className="week-chart">
              {s.activity.slice(-7).map((day) => (
                <div key={day.date} className="week-day">
                  <span className="tabular-nums">{day.count}</span>
                  <div className="week-bar-track">
                    <div
                      className="week-bar"
                      style={{
                        height: `${Math.max(day.count ? 6 : 0, (day.count / Math.max(...s.activity.map((d) => d.count), 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <small>
                    {new Date(day.date + "T12:00:00")
                      .toLocaleDateString("zh-CN", { weekday: "short" })
                      .replace("周", "")}
                  </small>
                </div>
              ))}
            </div>
            <p className="text-muted text-xs mt-4">
              {s.today
                ? "今天已经留下了你的学习足迹。"
                : "从今天开始，为这一周添上第一笔。"}
            </p>
          </Widget.Content>
        </Widget>
      </section>
      <section>
        <div className="section-heading">
          <div>
            <h2>找到你的下一本词书</h2>
            <p>从考试到生活，总有适合你的词汇。</p>
          </div>
          <Button variant="ghost" size="sm" onPress={() => navigate("/books")}>
            全部词书
            <I name="arrow-right" className="size-4" />
          </Button>
        </div>
        <div className="book-grid">
          {books.data.slice(0, 3).map((b, i) => (
            <BookCard key={b.id} book={b} index={i} />
          ))}
        </div>
      </section>
    </>
  );
}
