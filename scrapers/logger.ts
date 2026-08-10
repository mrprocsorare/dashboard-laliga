/**
 * Logger minimalista y consistente para el pipeline de scraping.
 * En entornos CI (GitHub Actions) cada línea va con prefijo de fuente.
 */

type Level = "info" | "warn" | "error";

function emit(level: Level, scope: string, message: string) {
  const line = `[scrape:${scope}] ${message}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function createLogger(scope: string) {
  return {
    info: (message: string) => emit("info", scope, message),
    warn: (message: string) => emit("warn", scope, message),
    error: (message: string) => emit("error", scope, message),
    errorWithCause: (message: string, err: unknown) =>
      emit("error", scope, `${message} :: ${err instanceof Error ? err.message : String(err)}`),
  };
}

export type Logger = ReturnType<typeof createLogger>;