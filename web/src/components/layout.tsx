import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button, Avatar, Dropdown, Label, Tooltip } from "@heroui/react";
import { Sidebar } from "@heroui-pro/react/sidebar";
import { useQuery } from "@tanstack/react-query";
import {
  api,
  send,
  queryClient,
  useBooks,
  useUser,
  type Navigation,
} from "../lib/api";
import { I, IconButton } from "./shared";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { toast } from "sonner";
import { errorText } from "../lib/utils";

const links = [
  { path: "/", label: "学习概览", icon: "house" },
  { path: "/books", label: "发现词书", icon: "book-open" },
  { path: "/sprint", label: "临考速刷", icon: "bolt" },
  { path: "/review", label: "复习与巩固", icon: "arrows-rotate-right" },
  { path: "/favorites", label: "我的收藏", icon: "bookmark" },
  { path: "/stats", label: "学习记录", icon: "chart-column" },
];
export function Layout() {
  const { data: user } = useUser();
  const { data: books } = useBooks();
  const location = useLocation();
  const navigate = useNavigate();
  const admin = location.pathname.startsWith("/admin");
  const [command, setCommand] = useState(false);
  const [dark, setDark] = useState(
    () =>
      localStorage.getItem("word-theme") === "dark" ||
      (!localStorage.getItem("word-theme") &&
        matchMedia("(prefers-color-scheme: dark)").matches),
  );
  const nav = useQuery({
    queryKey: ["navigation"],
    queryFn: () => api<Navigation[]>("/admin/navigation"),
    enabled: user?.role === "admin",
    refetchInterval: admin ? 30_000 : false,
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("word-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommand((v) => !v);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const items = admin
    ? (nav.data || [])
        .filter((n) => n.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : links;
  const context = admin
    ? "站点管理"
    : links.find((l) => l.path === location.pathname)?.label ||
      (location.pathname.startsWith("/books/") ? "词书详情" : "个人设置");
  async function logout() {
    try {
      await send("/auth/logout", {});
      queryClient.clear();
      window.location.assign("/login");
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  const contents = (
    <>
      <Sidebar.Header>
        <div className="brand">
          <div className="brand-mark">
            <I name="book-open" />
          </div>
          <div>
            <strong>就背单词</strong>
            <span>Words become yours.</span>
          </div>
        </div>
        <button className="sidebar-search" onClick={() => setCommand(true)}>
          <I name="magnifier" className="size-4" />
          <span>搜索与快速导航</span>
          <kbd>⌘ K</kbd>
        </button>
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.GroupLabel>
            {admin ? "管理工作台" : "我的学习空间"}
          </Sidebar.GroupLabel>
          <Sidebar.Menu aria-label={admin ? "管理导航" : "学习导航"}>
            {items.map((item) => (
              <Sidebar.MenuItem
                key={item.path}
                id={item.path}
                href={item.path}
                textValue={item.label}
                isCurrent={item.path === location.pathname}
              >
                <Sidebar.MenuIcon>
                  <I name={item.icon || "square-dashed"} />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
            ))}
          </Sidebar.Menu>
        </Sidebar.Group>
        {!admin && (
          <div className="sidebar-note">
            <span className="flex items-center gap-2 font-medium">
              <I name="leaf" className="size-4" />
              积少成多，记得更久
            </span>
            <p>
              每天 {user?.dailyGoal || 20} 个单词，
              <br />
              让进步成为一种习惯。
            </p>
            <button onClick={() => navigate("/settings")}>
              调整学习计划 <span>↗</span>
            </button>
          </div>
        )}
      </Sidebar.Content>
      <Sidebar.Footer>
        <Sidebar.Menu aria-label="辅助导航">
          <Sidebar.MenuItem
            id="settings"
            href="/settings"
            textValue="学习设置"
            isCurrent={location.pathname === "/settings"}
          >
            <Sidebar.MenuIcon>
              <I name="gear" />
            </Sidebar.MenuIcon>
            <Sidebar.MenuLabel>学习设置</Sidebar.MenuLabel>
          </Sidebar.MenuItem>
          {user?.role === "admin" && (
            <Sidebar.MenuItem
              id="admin-switch"
              href={admin ? "/" : "/admin"}
              textValue={admin ? "返回学习" : "管理后台"}
            >
              <Sidebar.MenuIcon>
                <I name={admin ? "arrow-left" : "sliders"} />
              </Sidebar.MenuIcon>
              <Sidebar.MenuLabel>
                {admin ? "返回学习" : "管理后台"}
              </Sidebar.MenuLabel>
            </Sidebar.MenuItem>
          )}
        </Sidebar.Menu>
        <Dropdown>
          <Button variant="ghost" className="profile-button">
            <Avatar size="sm">
              <Avatar.Fallback>
                {user?.name?.slice(0, 1) || "学"}
              </Avatar.Fallback>
            </Avatar>
            <span className="flex-1 text-left">
              <strong>{user?.name || "学习者"}</strong>
              <small>
                {user?.guest
                  ? "访客 · 本机保存进度"
                  : user?.role === "admin"
                    ? "站点管理员"
                    : "每天都在进步"}
              </small>
            </span>
            <I name="chevrons-expand-vertical" className="size-4 text-muted" />
          </Button>
          <Dropdown.Popover placement="top start">
            <Dropdown.Menu aria-label="个人账户">
              <Dropdown.Item
                id="settings"
                textValue="个人设置"
                onAction={() => navigate("/settings")}
              >
                <Label>个人设置</Label>
              </Dropdown.Item>
              {user?.guest && (
                <Dropdown.Item
                  id="register"
                  textValue="注册并保留进度"
                  onAction={() => navigate("/login?register=1")}
                >
                  <Label>注册并保留进度</Label>
                </Dropdown.Item>
              )}
              <Dropdown.Item id="logout" textValue="退出登录" onAction={logout}>
                <Label>退出登录</Label>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </Sidebar.Footer>
    </>
  );
  return (
    <Sidebar.Provider
      navigate={navigate}
      collapsible="offcanvas"
      className="app-layout"
    >
      <Sidebar className="app-sidebar">{contents}</Sidebar>
      <Sidebar.Mobile>{contents}</Sidebar.Mobile>
      <Sidebar.Main className="app-main">
        <div className="topbar">
          <div className="flex items-center gap-3">
            <Tooltip>
              <Sidebar.Trigger aria-label="切换导航" />
              <Tooltip.Content>切换导航</Tooltip.Content>
            </Tooltip>
            <span className="text-sm text-muted">
              {admin ? "管理后台" : "学习空间"}
              <span className="mx-3 text-border">/</span>
              <span className="text-foreground">{context}</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="today-date">
              {new Date().toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "short",
              })}
            </span>
            <IconButton
              label={dark ? "切换浅色模式" : "切换深色模式"}
              icon={dark ? "sun" : "moon"}
              onPress={() => setDark(!dark)}
            />
          </div>
        </div>
        <div className="page-content">
          <Outlet />
        </div>
        <footer className="app-footer">
          <span>就背单词</span>
          <span>把每一个单词，变成自己的。</span>
        </footer>
      </Sidebar.Main>
      <CommandDialog open={command} onOpenChange={setCommand}>
        <CommandInput placeholder="搜索页面、词书…" />
        <CommandList>
          <CommandEmpty>没有找到相关内容</CommandEmpty>
          <CommandGroup heading="快速前往">
            {links.map((item) => (
              <CommandItem
                key={item.path}
                onSelect={() => {
                  navigate(item.path);
                  setCommand(false);
                }}
                value={item.label}
              >
                <I name={item.icon} />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="词书">
            {books?.map((book) => (
              <CommandItem
                key={book.id}
                value={book.title}
                onSelect={() => {
                  navigate(`/books/${book.id}`);
                  setCommand(false);
                }}
              >
                <I name="book" />
                {book.title}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </Sidebar.Provider>
  );
}
