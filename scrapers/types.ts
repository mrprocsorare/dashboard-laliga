/**
 * Contrato de salida que TODO scraper debe cumplir.
 *
 * Cada fuente entrega su información de forma INDEPENDIENTE y se persiste
 * por separado (nunca se mezclan fuentes en esta capa). El motor de consenso
 * (services/consensus.ts, fase 3) consumirá estas tablas single-source.
 */

export type Position = "POR" | "DEF" | "MED" | "DEL";
export type EventType = "injury" | "suspension" | "doubt" | "transfer";
export type Severity = "none" | "light" | "moderate" | "serious" | "out";
export type ForecastType = "probable" | "confirmed";

/** Predicción de titularidad de un jugador para el próximo partido. */
export interface PlayerForecast {
  /** Nombre canónico/normalizado del jugador tal y como lo publica la fuente. */
  playerName: string;
  /** Probabilidad de ser titular (0-100). */
  probabilityPct: number;
  /** True si la fuente lo da casi como seguro. */
  isCertain?: boolean;
  /** Tipo de señal: actualmente las fuentes activas entregan probable. */
  forecastType?: ForecastType;
  /** Nota adicional de la fuente (alternativa, condición…). */
  note?: string;
  /** URL de la foto del jugador si la fuente la expone. */
  photoUrl?: string;
}

/** Evento (lesión, sanción, duda, fichaje) referido a un jugador. */
export interface PlayerEvent {
  playerName: string;
  eventType: EventType;
  severity?: Severity;
  reason?: string;
  expectedReturn?: string;
  note?: string;
}

/** Datos de equipo de la fuente: entrenador, sistema, noticias. */
export interface TeamInfo {
  coach?: string;
  formation?: string;
  news?: string;
}

/** Lanzadores de balón parado (arrays de nombres). */
export interface SetPieces {
  penaltyTakers?: string[];
  cornerTakers?: string[];
  freeKickTakers?: string[];
}

/** Bloque completo de datos que una fuente entrega para UN equipo. */
export interface TeamScrapeResult {
  /** Slug canónico del equipo en nuestra BBDD (teams.slug). */
  teamSlug: string;
  players: PlayerForecast[];
  events: PlayerEvent[];
  setPieces?: SetPieces;
  info?: TeamInfo;
}

/** Resultado global de la ejecución de una fuente. */
export interface ScraperResult {
  sourceId: string;
  teams: TeamScrapeResult[];
  fetchedAt: Date;
  /** true si hubo fallos aislados pero se consiguió persistir parte de los datos. */
  partial?: boolean;
}

/** OPTS context o control que todo scraper recibe. */
export interface ScraperContext {
  /** Metadatos de la fuente (id, name, baseUrl). */
  source: { id: string; name: string; baseUrl: string };
  /** Si true, se loguea más detalle (CLI local). */
  verbose?: boolean;
  /** Permite avisar del progreso para logs. */
  onProgress?: (message: string) => void;
}

/** Interfaz que implementa cada fuente de datos. */
export interface Scraper {
  readonly id: string;
  scrape(ctx: ScraperContext): Promise<ScraperResult>;
}
