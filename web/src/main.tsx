import { addCollection } from "@iconify/react";
import gravityIcons from "@iconify-json/gravity-ui/icons.json";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";
import { queryClient } from "./lib/api";
import App from "./App";
import "./styles.css";
addCollection(gravityIcons);
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <App />
        <Toaster richColors position="bottom-right" closeButton />
      </MotionConfig>
    </QueryClientProvider>
  </BrowserRouter>,
);
