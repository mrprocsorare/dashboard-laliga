import { Skeleton } from "@/components/ui/skeleton";

export default function HomeLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 p-6">
      <Skeleton className="h-20 w-full" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 20 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    </main>
  );
}
