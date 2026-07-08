import type { Metadata } from "next";
import { type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex Scheduler",
  description: "A local macOS scheduler for managing automated Codex CLI runs.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
