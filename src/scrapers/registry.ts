import type { Scraper } from "./interface.js";
import { ChaseScraper } from "./chase/index.js";
import { RobinhoodScraper } from "./robinhood/index.js";
import { FidelityScraper } from "./fidelity/index.js";
import { AmexScraper } from "./amex/index.js";

export const scraperRegistry: Record<string, () => Scraper> = {
  chase: () => new ChaseScraper(),
  robinhood: () => new RobinhoodScraper(),
  fidelity: () => new FidelityScraper(),
  amex: () => new AmexScraper(),
};
