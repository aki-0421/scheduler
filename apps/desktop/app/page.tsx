import { CalendarClock, Play, Plus, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";

const navItems = ["Tasks", "Runs", "Projects", "Settings"];

export default function Home() {
  return (
    <main className="min-h-dvh bg-muted/30">
      <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col">
        <header className="flex items-center justify-between border-b bg-background px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md border bg-background shadow-sm">
              <CalendarClock className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-balance">
                Codex Scheduler
              </h1>
              <p className="text-sm text-muted-foreground text-pretty">
                Local scheduled runs for Codex CLI.
              </p>
            </div>
          </div>
          <Button variant="outline" size="icon" aria-label="Open settings">
            <Settings aria-hidden="true" />
          </Button>
        </header>

        <div className="grid flex-1 grid-cols-[220px_1fr]">
          <aside className="border-r bg-background px-3 py-4">
            <nav className="grid gap-1" aria-label="Primary">
              {navItems.map((item) => (
                <Button
                  key={item}
                  variant={item === "Tasks" ? "secondary" : "ghost"}
                  className="justify-start"
                >
                  {item}
                </Button>
              ))}
            </nav>
          </aside>

          <section className="p-6">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-balance">Tasks</h2>
                <p className="mt-1 text-sm text-muted-foreground text-pretty">
                  Scheduled Codex runs will appear here.
                </p>
              </div>
              <Button>
                <Plus aria-hidden="true" />
                New task
              </Button>
            </div>

            <div className="rounded-lg border bg-background p-8 shadow-sm">
              <div className="mx-auto flex max-w-md flex-col items-center text-center">
                <div className="flex size-12 items-center justify-center rounded-md border bg-muted">
                  <Play className="size-5" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-base font-medium text-balance">
                  No scheduled tasks
                </h3>
                <p className="mt-2 text-sm text-muted-foreground text-pretty">
                  Create the first task when the scheduler backend is wired in.
                </p>
                <Button className="mt-5">
                  <Plus aria-hidden="true" />
                  New task
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
