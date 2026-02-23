import type { Scraper } from "./interface.js";
import { ChaseScraper } from "./chase/index.js";
import { RobinhoodScraper } from "./robinhood/index.js";

export const scraperRegistry: Record<string, () => Scraper> = {
  chase: () => new ChaseScraper(),
  robinhood: () => new RobinhoodScraper(),
};
