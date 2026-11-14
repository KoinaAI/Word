import { Icon } from "@iconify/react";
import { Button, Card, ProgressBar, Tooltip } from "@heroui/react";
import { EmptyState } from "@heroui-pro/react/empty-state";
import { KPI } from "@heroui-pro/react/kpi";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import type { Book } from "../lib/api";

export const I = ({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) => (
  <Icon
    icon={`gravity-ui:${name}`}
    className={`size-5 shrink-0 ${className}`}
  />
);
export function IconButton({
  label,
  icon,
  onPress,
  active = false,
  disabled = false,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip delay={250}>
      <Button
        isIconOnly
        variant={active ? "secondary" : "ghost"}
        aria-label={label}
        onPress={onPress}
        isDisabled={disabled}
      >
        <I name={icon} />
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && (
          <p className="text-muted mt-2 text-sm leading-6">{description}</p>
        )}
      </div>
      {action}
    </header>
  );
}
export function Empty({
  title,
  description,
  icon = "book-open",
  children,
}: {
  title: string;
  description: string;
  icon?: string;
  children?: ReactNode;
}) {
  return (
    <EmptyState className="empty-state-custom">
      <EmptyState.Header>
        <EmptyState.Media variant="icon">
          <I name={icon} />
        </EmptyState.Media>
        <EmptyState.Title>{title}</EmptyState.Title>
        <EmptyState.Description>{description}</EmptyState.Description>
      </EmptyState.Header>
      {children && <EmptyState.Content>{children}</EmptyState.Content>}
    </EmptyState>
  );
}
export function Loading() {
  return (
    <div className="loading-grid" aria-label="正在加载" aria-busy="true">
      {[1, 2, 3].map((i) => (
        <div className="loading-block" key={i} />
      ))}
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <Empty
      title="暂时没能加载"
      description={error.message}
      icon="circle-exclamation"
    >
      {retry && (
        <Button variant="secondary" onPress={retry}>
          重新加载
        </Button>
      )}
    </Empty>
  );
}
export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <ProgressBar aria-label={label} value={value} className="w-full">
      <ProgressBar.Track>
        <ProgressBar.Fill />
      </ProgressBar.Track>
    </ProgressBar>
  );
}
export function Metric({
  title,
  value,
  icon,
  caption,
}: {
  title: string;
  value: number;
  icon: string;
  caption: string;
}) {
  return (
    <KPI className="metric">
      <KPI.Header>
        <KPI.Title>{title}</KPI.Title>
        <I name={icon} className="text-accent" />
      </KPI.Header>
      <KPI.Content>
        <KPI.Value value={value} maximumFractionDigits={0} />
      </KPI.Content>
      <KPI.Footer className="text-muted text-xs">{caption}</KPI.Footer>
    </KPI>
  );
}
export const palette = ["violet", "blue", "green", "orange", "rose", "teal"];
export function BookCover({
  book,
  large = false,
}: {
  book: Book;
  large?: boolean;
}) {
  const tint = palette.includes(book.color)
    ? book.color
    : palette[(book.id - 1) % palette.length];
  return (
    <div
      className={`book-cover book-${tint} ${large ? "book-cover-large" : ""}`}
    >
      <div className="book-cover-rule" />
      <span className="book-cover-brand">就背单词 · 精选词库</span>
      <strong>{book.subtitle || book.category}</strong>
      <span className="book-cover-title">
        {book.title.replace(/精选/g, "")}
      </span>
      <span className="book-cover-bottom">
        Vocabulary Collection <span>↗</span>
      </span>
      <div className="book-cover-orbit" />
    </div>
  );
}
export function BookCard({ book, index = 0 }: { book: Book; index?: number }) {
  const navigate = useNavigate();
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.035 }}
    >
      <Card className="book-card">
        <button
          className="book-cover-button"
          onClick={() => navigate(`/books/${book.id}`)}
          aria-label={`查看${book.title}`}
        >
          <BookCover book={book} />
        </button>
        <Card.Content>
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-sm">{book.title}</h3>
            <span className="book-category">{book.category}</span>
          </div>
          <p className="text-muted text-xs mt-2 tabular-nums">
            {book.wordCount} 词 · 已学 {book.learnedCount}
          </p>
          <Progress
            value={
              book.wordCount ? (book.learnedCount / book.wordCount) * 100 : 0
            }
            label={`${book.title}学习进度`}
          />
        </Card.Content>
        <Card.Footer>
          <Button
            variant="secondary"
            className="w-full"
            onPress={() => navigate(`/books/${book.id}`)}
          >
            打开词书
            <I name="arrow-right" className="size-4" />
          </Button>
        </Card.Footer>
      </Card>
    </motion.div>
  );
}
