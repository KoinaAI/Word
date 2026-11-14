import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  api,
  modeNames,
  refreshLearning,
  send,
  speak,
  type Answer,
  type Book,
  type StudyMode,
  type Word,
} from "../lib/api";
import {
  Empty,
  ErrorState,
  I,
  IconButton,
  Loading,
} from "../components/shared";
import { errorText } from "../lib/utils";

const validModes: StudyMode[] = ["learn", "review", "sprint", "reinforce"];
export function Study() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const rawMode = params.get("mode") as StudyMode;
  const mode = validModes.includes(rawMode) ? rawMode : "learn";
  const data = useQuery({
    queryKey: ["study", id, mode],
    queryFn: () =>
      api<{ book: Book; words: Word[]; total: number }>(
        `/study?bookId=${id}&mode=${mode}`,
      ),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [index, setIndex] = useState(0),
    [revealed, setRevealed] = useState(false),
    [pending, setPending] = useState(false),
    [finished, setFinished] = useState(false),
    [results, setResults] = useState({ known: 0, unknown: 0, reinforce: 0 }),
    [autoAudio, setAutoAudio] = useState(
      () => localStorage.getItem("word-auto-audio") === "true",
    );
  const busy = useRef(false);
  const event = useRef<{ wordId: number; answer: Answer; id: string } | null>(
    null,
  );
  const word = data.data?.words[index];
  const sprint = mode === "sprint";
  useEffect(() => {
    setIndex(0);
    setRevealed(false);
    setFinished(false);
    setResults({ known: 0, unknown: 0, reinforce: 0 });
    event.current = null;
  }, [id, mode]);
  useEffect(() => {
    if (word && autoAudio) speak(word.text);
    return () => {
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    };
  }, [word?.id, autoAudio]);
  const answer = useCallback(
    async (value: Answer) => {
      if (!word || busy.current) return;
      busy.current = true;
      setPending(true);
      // A retry reuses its event ID, so a network interruption cannot count the same answer twice.
      if (
        !event.current ||
        event.current.wordId !== word.id ||
        event.current.answer !== value
      )
        event.current = {
          wordId: word.id,
          answer: value,
          id: crypto.randomUUID(),
        };
      try {
        await send("/study/answer", {
          wordId: word.id,
          mode,
          answer: value,
          eventId: event.current.id,
        });
        setResults((r) => ({
          ...r,
          [value === "known"
            ? "known"
            : value === "unsure-known"
              ? "reinforce"
              : "unknown"]:
            r[
              value === "known"
                ? "known"
                : value === "unsure-known"
                  ? "reinforce"
                  : "unknown"
            ] + 1,
        }));
        event.current = null;
        setRevealed(false);
        if (index + 1 >= (data.data?.words.length || 0)) {
          setFinished(true);
          void refreshLearning();
        } else setIndex((i) => i + 1);
      } catch (e) {
        toast.error(errorText(e));
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [word, mode, index, data.data?.words.length],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        busy.current ||
        finished ||
        !word ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          ["INPUT", "TEXTAREA", "BUTTON"].includes(e.target.tagName))
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!sprint || revealed) setRevealed(true);
        else speak(word.text);
      }
      if (e.key === "1") {
        e.preventDefault();
        void answer(revealed && sprint ? "unsure-unknown" : "unknown");
      }
      if (e.key === "2" && sprint && !revealed) {
        e.preventDefault();
        setRevealed(true);
      }
      if (e.key === "3" && (sprint || revealed)) {
        e.preventDefault();
        void answer(revealed && sprint ? "unsure-known" : "known");
      }
      if (e.key.toLowerCase() === "p") speak(word.text);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [word, sprint, revealed, finished, answer]);
  const exit = () => {
    void refreshLearning();
    navigate(`/books/${id}`);
  };
  if (data.error)
    return (
      <div className="study-shell">
        <ErrorState error={data.error} retry={() => void data.refetch()} />
        <Button variant="ghost" onPress={exit}>
          返回词书
        </Button>
      </div>
    );
  if (!data.data)
    return (
      <div className="study-shell">
        <Loading />
      </div>
    );
  if (finished)
    return (
      <div className="study-shell">
        <div className="study-finished">
          <div className="completion-icon">
            <I name="check" className="size-9" />
          </div>
          <p className="eyebrow mt-6">One step closer</p>
          <h1>这一轮，做得很好。</h1>
          <p className="text-muted mt-3">
            你的每一次判断，都让下一次学习更有方向。
          </p>
          <div className="result-metrics">
            <div>
              <strong>{results.known}</strong>
              <span>已经记住</span>
            </div>
            <div>
              <strong>{results.reinforce}</strong>
              <span>加入巩固</span>
            </div>
            <div>
              <strong>{results.unknown}</strong>
              <span>继续攻克</span>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Button onPress={exit}>返回词书</Button>
            {results.reinforce > 0 && (
              <Button
                variant="secondary"
                onPress={() => navigate(`/study/${id}?mode=reinforce`)}
              >
                开始巩固
              </Button>
            )}
            <Button
              variant="outline"
              onPress={() => {
                setIndex(0);
                setFinished(false);
                setResults({ known: 0, unknown: 0, reinforce: 0 });
                void data.refetch();
              }}
            >
              再来一轮
            </Button>
          </div>
        </div>
      </div>
    );
  if (!word)
    return (
      <div className="study-shell">
        <Empty
          title={
            mode === "review"
              ? "还没有到期的单词"
              : mode === "reinforce"
                ? "巩固列表已清空"
                : "这本词书已经学完啦"
          }
          description={
            mode === "review"
              ? "复习时间会根据每次回答自动安排，稍后再来看看。"
              : "可以选择其他词书，或等到复习时间再来。"
          }
          icon="circle-check"
        >
          <Button onPress={exit}>返回词书</Button>
        </Empty>
      </div>
    );
  return (
    <div className={`study-shell ${sprint ? "sprint-shell" : ""}`}>
      <div className="study-top">
        <Button variant="ghost" size="sm" onPress={exit}>
          <I name="arrow-left" className="size-4" />
          <span className="study-back-text">退出学习</span>
        </Button>
        <div className="study-context">
          <span>{data.data.book.title}</span>
          <Chip size="sm" variant="soft">
            {modeNames[mode]}
          </Chip>
        </div>
        <span className="study-counter">
          {index + 1}
          <span> / {data.data.words.length}</span>
        </span>
      </div>
      <div className="study-progress-line">
        <div style={{ width: `${(index / data.data.words.length) * 100}%` }} />
      </div>
      <div className="study-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={word.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="study-word"
          >
            <h1>{word.text}</h1>
            <div className="study-phonetic">
              <span>{word.phonetic}</span>
              <IconButton
                label="播放发音（P）"
                icon="volume-high"
                onPress={() => {
                  if (!speak(word.text))
                    toast.error("当前浏览器不支持语音朗读");
                }}
              />
            </div>
            {revealed && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="word-meaning"
              >
                <p>{word.meaning}</p>
                {!sprint && (
                  <>
                    <blockquote>{word.example}</blockquote>
                    <span>{word.exampleMeaning}</span>
                  </>
                )}
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="study-bottom">
        {!sprint && !revealed ? (
          <Button className="reveal-button" onPress={() => setRevealed(true)}>
            显示释义<span className="key-hint">Space</span>
          </Button>
        ) : (
          <div
            className={`answer-buttons ${revealed || !sprint ? "two-answers" : ""}`}
          >
            <Button
              variant="secondary"
              className="answer-unknown"
              isDisabled={pending}
              onPress={() =>
                void answer(sprint && revealed ? "unsure-unknown" : "unknown")
              }
            >
              <I name="xmark" />
              <span>不会</span>
              <kbd>1</kbd>
            </Button>
            {sprint && !revealed && (
              <Button
                variant="secondary"
                className="answer-unsure"
                isDisabled={pending}
                onPress={() => setRevealed(true)}
              >
                <I name="circle-question" />
                <span>不确定</span>
                <kbd>2</kbd>
              </Button>
            )}
            <Button
              className="answer-known"
              isDisabled={pending}
              onPress={() =>
                void answer(sprint && revealed ? "unsure-known" : "known")
              }
            >
              <I name="check" />
              <span>{sprint && revealed ? "会，加入巩固" : "会"}</span>
              <kbd>3</kbd>
            </Button>
          </div>
        )}
        {!sprint && (
          <div className="study-options">
            <IconButton
              label={autoAudio ? "关闭自动发音" : "开启自动发音"}
              icon="volume-high"
              active={autoAudio}
              onPress={() => {
                localStorage.setItem("word-auto-audio", String(!autoAudio));
                setAutoAudio(!autoAudio);
              }}
            />
            <span>按 P 发音 · 1 不会 · 3 会</span>
            <IconButton
              label="收藏单词"
              icon="bookmark"
              onPress={() => {
                void send(`/favorites/${word.id}`, { favorite: true })
                  .then(() => toast.success("已收藏"))
                  .catch((e) => toast.error(errorText(e)));
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
