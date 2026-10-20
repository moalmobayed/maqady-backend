import { config } from 'dotenv';

/**
 * Loads `.env` into `process.env` for local runs. Variables already set in the real environment
 * (Render, CI) always win, and a missing file is not an error.
 */
export function loadDotenv(): void {
  config({ quiet: true });
}
