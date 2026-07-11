import { AppLink } from "@/components/app-link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="grid max-w-md gap-3 text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="text-xl font-semibold text-balance">ページが見つかりません</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          指定されたページは存在しないか、移動された可能性があります。
        </p>
        <div className="mt-2 flex justify-center">
          <Button asChild>
            <AppLink href="/projects">プロジェクトへ戻る</AppLink>
          </Button>
        </div>
      </div>
    </div>
  );
}
