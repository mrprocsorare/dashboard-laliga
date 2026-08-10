/**
 * Errores tipados del framework de scraping. Permitimos distinguir fallos
 * irreversibles de fuentes de fallos de un solo ítem (para continuar con el resto).
 */

/** Se lanza cuando una fuente deja de funcionar por completo. */
export class SourceDownError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SourceDownError";
  }
}

/** Se lanza cuando una página no contiene los elementos esperados. */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

/** Resultado vacío/trivial: la fuente responde pero entrega datos que no
 *  deberían sobrescribir los buenos que ya tenemos. */
export class EmptyScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyScrapeError";
  }
}