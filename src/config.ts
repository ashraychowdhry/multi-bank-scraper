import "dotenv/config";

export interface Config {
  chaseUsername: string;
  chasePassword: string;
  headless: boolean;
  authStatePath: string;
  outputDir: string;
  slowMo: number;
}

export function loadConfig(): Config {
  const username = process.env.CHASE_USERNAME;
  const password = process.env.CHASE_PASSWORD;

  if (!username || !password) {
    console.error(
      "Error: CHASE_USERNAME and CHASE_PASSWORD must be set in .env"
    );
    process.exit(1);
  }

  return {
    chaseUsername: username,
    chasePassword: password,
    headless: process.env.HEADLESS !== "false",
    authStatePath: process.env.AUTH_STATE_PATH || ".auth/chase-state.json",
    outputDir: process.env.OUTPUT_DIR || "output",
    slowMo: parseInt(process.env.SLOW_MO || "50", 10),
  };
}
