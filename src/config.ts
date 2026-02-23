import "dotenv/config";

export interface GlobalConfig {
  headless: boolean;
  slowMo: number;
  outputDir: string;
  enabledScrapers: string[];
}

export function loadGlobalConfig(): GlobalConfig {
  return {
    headless: process.env.HEADLESS !== "false",
    slowMo: parseInt(process.env.SLOW_MO || "50", 10),
    outputDir: process.env.OUTPUT_DIR || "output",
    enabledScrapers: (process.env.SCRAPERS || "chase")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function loadScraperConfig(
  scraperName: string,
  global: GlobalConfig
): import("./scrapers/interface.js").ScraperConfig {
  const prefix = scraperName.toUpperCase();

  const credentials: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(`${prefix}_`) && value) {
      const credKey = key.slice(prefix.length + 1).toLowerCase();
      credentials[credKey] = value;
    }
  }

  return {
    headless: global.headless,
    slowMo: global.slowMo,
    authStatePath: `.auth/${scraperName}-state.json`,
    credentials,
  };
}
