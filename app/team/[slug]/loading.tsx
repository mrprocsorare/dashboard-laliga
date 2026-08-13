import { Skeleton } from "@/components/ui/skeleton";

export default function TeamLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-20 border-b bg-background/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5 sm:px-6">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      </div>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mx-auto aspect-[3/4] w-full max-w-sm rounded-2xl sm:max-w-md" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </main>
    </div>
  );
}