import { NextResponse, type NextRequest } from "next/server";
import { getSorareData } from "@/lib/sorare";

export const dynamic = "force-dynamic";

/** Proxy opcional para consumidores del dashboard; nunca llama a Sorare desde el cliente. */
export async function GET(request: NextRequest) {
  const slugs = request.nextUrl.searchParams
    .getAll("slug")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 50);
  const data = await getSorareData(slugs);
  return NextResponse.json({ players: [...data.values()] });
}
