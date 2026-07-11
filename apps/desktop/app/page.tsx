"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/projects");
  }, [router]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <p role="status" className="text-sm text-muted-foreground">
          プロジェクトを開いています…
        </p>
        <Link
          href="/projects"
          className="text-sm font-medium text-foreground underline underline-offset-4"
        >
          自動的に移動しない場合はこちら
        </Link>
      </div>
    </div>
  );
}
