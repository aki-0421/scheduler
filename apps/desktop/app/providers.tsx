"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";

function ThemeController() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const stored = window.localStorage.getItem("codex-scheduler-theme");
      const shouldUseDark =
        stored === "dark" || (stored !== "light" && media.matches);
      document.documentElement.classList.toggle("dark", shouldUseDark);
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
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
