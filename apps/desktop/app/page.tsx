"use client";

import { useEffect } from "react";

import { AppLink } from "@/components/app-link";
import { replaceWithScreen } from "@/lib/navigation";

export default function HomePage() {
  useEffect(() => {
    replaceWithScreen("/projects");
  }, []);

  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <p role="status" className="text-sm text-muted-foreground">
          プロジェクトを開いています…
        </p>
        <AppLink
          href="/projects"
          className="text-sm font-medium text-foreground underline underline-offset-4"
        >
          自動的に移動しない場合はこちら
        </AppLink>
      </div>
    </div>
  );
}
