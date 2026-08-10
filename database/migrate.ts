import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Falta DATABASE_URL en el entorno. Abortando.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  console.log("Ejecutando migraciones...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migraciones aplicadas.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
