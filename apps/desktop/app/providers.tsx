"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";

type ThemeRuntime = {
  applyTheme: () => void;
  media: MediaQueryList;
};

declare global {
  interface Window {
    __CLOCKHAND_THEME__?: ThemeRuntime;
  }
}

function createThemeRuntime(): ThemeRuntime {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const applyTheme = () => {
    let storedTheme = null;
    try {
      storedTheme = window.localStorage.getItem("codex-scheduler-theme");
    } catch {
      // Use the operating-system preference when storage is unavailable.
    }

    const dark =
      storedTheme === "dark" || (storedTheme !== "light" && media.matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  };

  return { applyTheme, media };
}

function ThemeController() {
  useEffect(() => {
    const runtime = window.__CLOCKHAND_THEME__ ?? createThemeRuntime();
    runtime.applyTheme();
    runtime.media.addEventListener("change", runtime.applyTheme);
    return () =>
      runtime.media.removeEventListener("change", runtime.applyTheme);
  }, []);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeController />
      <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
      <Toaster richColors closeButton position="bottom-right" />
    </QueryClientProvider>
  );
}
