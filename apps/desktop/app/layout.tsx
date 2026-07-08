import type { Metadata } from "next";
import { type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex Scheduler",
  description: "Codex CLI の自動実行を管理するローカル macOS スケジューラー。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
