import { lazy, Suspense } from "react";
import { Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Button } from "@heroui/react";
import { useUser } from "./lib/api";
import { Layout } from "./components/layout";
import { Empty, ErrorState, Loading } from "./components/shared";
const AdminGate = lazy(() =>
  import("./pages/admin").then((m) => ({ default: m.AdminGate })),
);
const AdminOverview = lazy(() =>
  import("./pages/admin").then((m) => ({ default: m.AdminOverview })),
);
const AdminBooks = lazy(() =>
  import("./pages/admin").then((m) => ({ default: m.AdminBooks })),
);
const AdminBookWords = lazy(() =>
  import("./pages/admin").then((m) => ({ default: m.AdminBookWords })),
);
const AdminUsers = lazy(() =>
  import("./pages/admin").then((m) => ({ default: m.AdminUsers })),
);
const AdminNavigation = lazy(() =>
  import("./pages/admin").then((m) => ({ default: m.AdminNavigation })),
);
import { Home } from "./pages/home";
import { BookDetail, Books, Favorites } from "./pages/books";
import { Study } from "./pages/study";
import { Review, Statistics } from "./pages/progress";
import { Login, Settings } from "./pages/account";

function Session() {
  const user = useUser();
  const location = useLocation();
  if (location.pathname === "/login") return <Outlet />;
  if (user.error)
    return <ErrorState error={user.error} retry={() => void user.refetch()} />;
  if (!user.data)
    return (
      <div className="session-loading">
        <Loading />
      </div>
    );
  return <Outlet />;
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Session />}>
          <Route path="/login" element={<Login />} />
          <Route path="/study/:id" element={<Study />} />
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="books" element={<Books />} />
            <Route path="books/:id" element={<BookDetail />} />
            <Route path="sprint" element={<Books sprint />} />
            <Route path="review" element={<Review />} />
            <Route path="favorites" element={<Favorites />} />
            <Route path="stats" element={<Statistics />} />
            <Route path="settings" element={<Settings />} />
            <Route
              path="admin"
              element={
                <AdminGate>
                  <AdminOverview />
                </AdminGate>
              }
            />
            <Route
              path="admin/books"
              element={
                <AdminGate>
                  <AdminBooks />
                </AdminGate>
              }
            />
            <Route
              path="admin/books/:id"
              element={
                <AdminGate>
                  <AdminBookWords />
                </AdminGate>
              }
            />
            <Route
              path="admin/users"
              element={
                <AdminGate>
                  <AdminUsers />
                </AdminGate>
              }
            />
            <Route
              path="admin/navigation"
              element={
                <AdminGate>
                  <AdminNavigation />
                </AdminGate>
              }
            />
            <Route
              path="*"
              element={
                <Empty
                  title="页面走丢了"
                  description="回到学习空间，继续你的下一步。"
                >
                  <Button onPress={() => window.location.assign("/")}>
                    返回首页
                  </Button>
                </Empty>
              }
            />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
