import type { Scraper } from "./types";
import { ComuniateScraper } from "./sources/comuniate";

/**
 * Registro central de scrapers. Aquí se añaden nuevas fuentes sin tocar nada
 * más (cadascuno es 100% independiente).
 */
export function getRegisteredScrapers(): Scraper[] {
  return [new ComuniateScraper()];
}