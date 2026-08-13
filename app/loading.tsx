import { Skeleton } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-20 border-b bg-background/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5 sm:px-6">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      </div>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6">
        <Skeleton className="h-4 w-24" />
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-32 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-4 w-48" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {Array.from({ length: 20 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </main>
    </div>
  );
}