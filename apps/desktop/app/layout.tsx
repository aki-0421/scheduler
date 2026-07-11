import type { Metadata } from "next";
import { type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clockhand",
  description: "ローカル AI agent の実行を管理するデスクトップスケジューラー。",
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
