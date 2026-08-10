import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Cliente de Drizzle para el backend de scraping / scripts (Node).
 * NO se usa desde el frontend de Next.js (ahí se usa Supabase Auth).
 * Lo importa cualquier proceso Node que quiera escribir datos
 * (orchestrator de scrapers, seeds, migraciones).
 */
export function createDbClient(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool, schema };
}