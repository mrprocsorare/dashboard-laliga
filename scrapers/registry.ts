import type { Scraper } from "./types";
import { ComuniateScraper } from "./sources/comuniate";
import { FutbolFantasyScraper } from "./sources/futbolfantasy";
import { AnaliticaFantasyScraper } from "./sources/analiticafantasy";
import { JornadaPerfectaScraper } from "./sources/jornadaperfecta";
import { BiwengerScraper } from "./sources/biwenger";

/**
 * Registro central de scrapers. Aquí se añaden nuevas fuentes sin tocar nada
 * más (cada una es 100% independiente).
 */
export function getRegisteredScrapers(): Scraper[] {
  return [
    new ComuniateScraper(),
    new FutbolFantasyScraper(),
    new AnaliticaFantasyScraper(),
    new JornadaPerfectaScraper(),
    new BiwengerScraper(),
  ];
}