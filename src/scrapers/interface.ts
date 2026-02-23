import type { ScraperResult } from "../types.js";

export interface ScraperConfig {
  headless: boolean;
  slowMo: number;
  authStatePath: string;
  credentials: Record<string, string>;
}

export interface Scraper {
  readonly name: string;
  readonly displayName: string;
  scrape(config: ScraperConfig): Promise<ScraperResult>;
}
