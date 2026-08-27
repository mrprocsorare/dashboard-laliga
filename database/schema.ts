import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Enumerados compartidos.
 */
export const positionEnum = pgEnum("position", ["POR", "DEF", "MED", "DEL"]);
export const playerEventTypeEnum = pgEnum("player_event_type", [
  "injury",
  "suspension",
  "doubt",
  "transfer",
]);
export const eventSeverityEnum = pgEnum("event_severity", [
  "none",
  "light",
  "moderate",
  "serious",
  "out",
]);
export const runStatusEnum = pgEnum("run_status", [
  "running",
  "success",
  "partial",
  "failed",
]);
export const forecastTypeEnum = pgEnum("forecast_type", ["probable", "confirmed"]);
export const sorareMappingStatusEnum = pgEnum("sorare_mapping_status", [
  "matched",
  "manual_review",
  "not_found",
]);

/**
 * Catálogo de fuentes de datos. `reliability_weight` se usa para la media
 * ponderada del motor de consenso.
 */
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    reliabilityWeight: text("reliability_weight").notNull().default("1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sources_slug_idx").on(t.slug)],
);

/**
 * Equipos de LaLiga.
 */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    logoUrl: text("logo_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("teams_slug_idx").on(t.slug)],
);

/**
 * Jugadores, pertenecientes a un equipo.
 */
export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: positionEnum("position"),
    photoUrl: text("photo_url"),
    sorareSlug: text("sorare_slug"),
    dateOfBirth: text("date_of_birth"),
    nationality: text("nationality"),
    /**
     * Nombre canónico que el roster cerrado (Wikipedia) asigna a este jugador.
     * Cuando un nombre scrapeado matchea este canónico (vía roster matcher),
     * la fila `players` queda ligada al canónico. Si difiere del `name` que
     * escribió la primera fuente, conservamos ambos: `name` se queda como
     * estaba y `canonical_name` aporta la forma canónica. La UI muestra
     * siempre `canonical_name` cuando existe.
     */
    canonicalName: text("canonical_name"),
    /**
     * `true` cuando esta fila se creó (o se revalidó) desde el roster
     * canónico de Wikipedia. Es el ancla del matching cerrado: si está
     * activada, ningún nuevo scrape puede crear OTRO jugador con el mismo
     * nombre canónico, porque ya forma parte del roster.
     */
    isCanonicalRoster: boolean("is_canonical_roster").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("players_team_name_idx").on(t.teamId, t.name),
    uniqueIndex("players_team_canonical_idx").on(t.teamId, t.canonicalName),
    index("players_sorare_slug_idx").on(t.sorareSlug),
    index("players_team_idx").on(t.teamId),
  ],
);

/**
 * Registro de cada ejecución de scraper. Permite conocer el estado de las
 * fuentes en el dashboard y auditar fallos sin perder datos válidos.
 */
export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    status: runStatusEnum("status").notNull().default("running"),
    itemsProcessed: integer("items_processed").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("scrape_runs_source_idx").on(t.sourceId),
    index("scrape_runs_started_idx").on(t.startedAt),
  ],
);

/**
 * Predicción de titularidad por jugador Y fuente. Una fila por pareja
 * (player_id, source_id): último valor VÁLIDO. Solo se sobrescribe si el nuevo
 * dato no está vacío; en caso contrario se conserva este y se registra el error.
 */
export const latestPlayerForecast = pgTable(
  "latest_player_forecast",
  {
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    probabilityPct: integer("probability_pct").notNull(),
    isCertain: boolean("is_certain").notNull().default(false),
    forecastType: forecastTypeEnum("forecast_type").notNull().default("probable"),
    note: text("note"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.sourceId] }),
    index("latest_player_forecast_player_idx").on(t.playerId),
  ],
);

/**
 * Información general por equipo y fuente (entrenador, sistema, noticias).
 */
export const latestTeamInfo = pgTable(
  "latest_team_info",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    coach: text("coach"),
    formation: text("formation"),
    news: text("news"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.sourceId] }),
    index("latest_team_info_team_idx").on(t.teamId),
  ],
);

/**
 * Lanzadores de balón parado por equipo y fuente. Arrays como JSONB.
 */
export const latestSetPieces = pgTable(
  "latest_set_pieces",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    penaltyTakers: jsonb("penalty_takers").$type<string[]>(),
    cornerTakers: jsonb("corner_takers").$type<string[]>(),
    freeKickTakers: jsonb("free_kick_takers").$type<string[]>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.sourceId] }),
    index("latest_set_pieces_team_idx").on(t.teamId),
  ],
);

/**
 * Eventos (lesión, sanción, duda, fichaje) por jugador y fuente. Append-only:
 * se consulta el último evento por (player, source, type). Nunca se borran.
 */
export const playerEvents = pgTable(
  "player_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    eventType: playerEventTypeEnum("event_type").notNull(),
    severity: eventSeverityEnum("severity").notNull().default("none"),
    reason: text("reason"),
    expectedReturn: text("expected_return"),
    note: text("note"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("player_events_player_idx").on(t.playerId),
    index("player_events_type_idx").on(t.eventType),
  ],
);

/**
 * Consenso por jugador, materializado por el motor tras cada run.
 * `agreement` conserva siempre el detalle por fuente (nunca se ocultan
 * discrepancias): [{ source, probability, fetched_at }].
 */
export const playerConsensus = pgTable("player_consensus", {
  playerId: uuid("player_id").primaryKey().notNull().references(() => players.id, {
    onDelete: "cascade",
  }),
  probabilityPct: integer("probability_pct").notNull(),
  sourcesTotal: integer("sources_total").notNull().default(0),
  sourcesConsideringStarter: integer("sources_starter").notNull().default(0),
  agreement: jsonb("agreement").$type<
    {
      source: string;
      probability: number;
      fetched_at: string;
      forecast_type: "probable" | "confirmed";
    }[]
  >(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Forecasts scrapeados cuyo nombre NO matcheó con suficiente confianza
 * contra el roster canónico del equipo. Se conservan para revisión manual
 * (típicamente porque el jugador se ha fichado muy recientemente y aún no
 * aparece en la plantilla de Wikipedia). Se limpian tras asignarlos a un
 * `player_id` o descartarlos.
 */
export const unmatchedForecasts = pgTable(
  "unmatched_forecasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    rawName: text("raw_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    probabilityPct: integer("probability_pct"),
    isCertain: boolean("is_certain").notNull().default(false),
    forecastType: forecastTypeEnum("forecast_type").notNull().default("probable"),
    note: text("note"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Si tras revisión manual se asigna a un jugador del roster, se guarda
     * el `player_id` aquí. `null` = pendiente de revisión.
     */
    resolvedPlayerId: uuid("resolved_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("unmatched_team_idx").on(t.teamId),
    index("unmatched_source_idx").on(t.sourceId),
    index("unmatched_resolved_idx").on(t.resolvedPlayerId),
  ],
);

/**
 * Consenso por equipo, materializado por el motor.
 */
export const teamConsensus = pgTable("team_consensus", {
  teamId: uuid("team_id")
    .primaryKey()
    .references(() => teams.id, { onDelete: "cascade" }),
  formation: text("formation"),
  coach: text("coach"),
  setPieces: jsonb("set_pieces").$type<{
    penalty: string[];
    corner: string[];
    free_kick: string[];
  }>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Cuotas 1X2 normalizadas de The Odds API. Hay una fila por evento externo:
 * si la casa preferida cambia, se actualiza la misma fila y se conserva la
 * casa elegida en `bookmaker`.
 */
export const matchOdds = pgTable(
  "match_odds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalEventId: text("external_event_id").notNull().unique(),
    homeTeamId: uuid("home_team_id").references(() => teams.id, { onDelete: "set null" }),
    awayTeamId: uuid("away_team_id").references(() => teams.id, { onDelete: "set null" }),
    homeTeamName: text("home_team_name").notNull(),
    awayTeamName: text("away_team_name").notNull(),
    commenceTime: timestamp("commence_time", { withTimezone: true }).notNull(),
    /** Jornada inferida por bloques cronológicos de 10 partidos (LaLiga). */
    matchday: integer("matchday"),
    probabilityHomePct: integer("probability_home_pct"),
    probabilityDrawPct: integer("probability_draw_pct"),
    probabilityAwayPct: integer("probability_away_pct"),
    bookmaker: text("bookmaker"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("match_odds_event_idx").on(t.externalEventId),
    index("match_odds_commence_idx").on(t.commenceTime),
    index("match_odds_matchday_idx").on(t.matchday),
  ],
);

/**
 * Mapping auditable entre el roster local y la identidad de Sorare. El slug
 * de `players` se conserva por compatibilidad, pero esta tabla es la fuente
 * de verdad y permite dejar dudas sin convertirlas en falsos positivos.
 */
export const sorarePlayerMappings = pgTable(
  "sorare_player_mappings",
  {
    playerId: uuid("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    sorareSlug: text("sorare_slug"),
    displayName: text("display_name"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    birthDay: text("birth_day"),
    nationality: text("nationality"),
    activeClubName: text("active_club_name"),
    activeClubSlug: text("active_club_slug"),
    matchingMethod: text("matching_method").notNull().default("not_found"),
    confidence: real("confidence"),
    status: sorareMappingStatusEnum("status").notNull().default("not_found"),
    reason: text("reason"),
    candidates: jsonb("candidates").$type<unknown[]>(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    identityExpiresAt: timestamp("identity_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sorare_player_mappings_slug_idx").on(t.sorareSlug),
    index("sorare_player_mappings_status_idx").on(t.status),
    index("sorare_player_mappings_expiry_idx").on(t.identityExpiresAt),
  ],
);

/**
 * Cache persistente por slug. Scores y precios tienen TTL independientes para
 * que una caída parcial de Sorare nunca borre el último dato válido.
 */
export const sorarePlayerCache = pgTable(
  "sorare_player_cache",
  {
    sorareSlug: text("sorare_slug").primaryKey(),
    displayName: text("display_name"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    birthDay: text("birth_day"),
    nationality: text("nationality"),
    activeClubName: text("active_club_name"),
    activeClubSlug: text("active_club_slug"),
    scores: jsonb("scores").$type<number[]>(),
    averageScore: real("average_score"),
    latestScore: real("latest_score"),
    scoresUpdatedAt: timestamp("scores_updated_at", { withTimezone: true }),
    scoresExpiresAt: timestamp("scores_expires_at", { withTimezone: true }),
    classicPriceEurCents: integer("classic_price_eur_cents"),
    classicCardSlug: text("classic_card_slug"),
    classicUpdatedAt: timestamp("classic_updated_at", { withTimezone: true }),
    classicExpiresAt: timestamp("classic_expires_at", { withTimezone: true }),
    inSeasonPriceEurCents: integer("in_season_price_eur_cents"),
    inSeasonCardSlug: text("in_season_card_slug"),
    inSeasonUpdatedAt: timestamp("in_season_updated_at", { withTimezone: true }),
    inSeasonExpiresAt: timestamp("in_season_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sorare_player_cache_scores_expiry_idx").on(t.scoresExpiresAt),
    index("sorare_player_cache_classic_expiry_idx").on(t.classicExpiresAt),
    index("sorare_player_cache_in_season_expiry_idx").on(t.inSeasonExpiresAt),
  ],
);

export const sorareSyncRuns = pgTable(
  "sorare_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: runStatusEnum("status").notNull().default("running"),
    playersTotal: integer("players_total").notNull().default(0),
    mappingsMatched: integer("mappings_matched").notNull().default(0),
    mappingsPending: integer("mappings_pending").notNull().default(0),
    mappingsNotFound: integer("mappings_not_found").notNull().default(0),
    apiCalls: integer("api_calls").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("sorare_sync_runs_started_idx").on(t.startedAt)],
);

/**
 * Puente genérico de identidad entre `players` (identidad canónica del
 * dashboard) y cualquier fuente externa. Cada fila enlaza un `player_id`
 * con un `external_player_id` (p. ej. el slug de Sorare) bajo una fuente
 * concreta (`sources`). Sustituye a la tabla específica `sorare_player_mappings`
 * como fuente de verdad, de modo que otras fuentes (alineaciones, stats API)
 * puedan enchufarse por el mismo mecanismo.
 *
 * - `status` (reusa el enum `sorare_mapping_status`) distingue `matched`
 *   (verificado), `manual_review` (dudoso, nunca auto-asociado) y `not_found`.
 * - `is_verified` = true solo para `matched` de alta confianza (exact/high).
 *   `medium/low` quedan en `manual_review`.
 * - (player_id, source_id) es PK: un jugador tiene a lo sumo un mapeo por
 *   fuente. (source_id, external_player_id) es único: un external id no puede
 *   estar asignado a dos jugadores distintos.
 */
export const playerSourceIds = pgTable(
  "player_source_ids",
  {
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    /** Identidad estable de la fuente (p. ej. Sorare relay `id`). No depende del slug. */
    externalPlayerId: text("external_player_id"),
    /** Slug de la fuente (p. ej. slug de Sorare). Denormalizado para lookup de cache. */
    externalSlug: text("external_slug"),
    externalName: text("external_name"),
    externalDob: text("external_dob"),
    externalClub: text("external_club"),
    confidence: real("confidence"),
    matchMethod: text("match_method").notNull().default("not_found"),
    isVerified: boolean("is_verified").notNull().default(false),
    status: sorareMappingStatusEnum("status").notNull().default("not_found"),
    candidates: jsonb("candidates").$type<unknown[]>(),
    reason: text("reason"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    identityExpiresAt: timestamp("identity_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.sourceId] }),
    uniqueIndex("player_source_ids_source_ext_idx").on(t.sourceId, t.externalPlayerId),
    uniqueIndex("player_source_ids_source_slug_idx")
      .on(t.sourceId, t.externalSlug)
      .where(sql`${t.status} = 'matched'`),
    index("player_source_ids_status_idx").on(t.status),
    index("player_source_ids_expiry_idx").on(t.identityExpiresAt),
  ],
);

export type Source = typeof sources.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Player = typeof players.$inferSelect;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
export type MatchOdds = typeof matchOdds.$inferSelect;
export type SorarePlayerMapping = typeof sorarePlayerMappings.$inferSelect;
export type SorarePlayerCache = typeof sorarePlayerCache.$inferSelect;
export type SorareSyncRun = typeof sorareSyncRuns.$inferSelect;
export type PlayerSourceId = typeof playerSourceIds.$inferSelect;
