import { Skeleton } from "@/components/ui/skeleton";

export default function TeamLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 p-6">
      <Skeleton className="h-20 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-96 w-full" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    </main>
  );
}
