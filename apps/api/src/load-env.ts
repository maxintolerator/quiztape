import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load `.env` from the repo root (and apps/api/.env if present) into
 * process.env for local runs. Production deployments set real env vars and
 * ship no .env file, so a missing file is fine. Existing variables win.
 */
export function loadDotenv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, '..', '..', '..', '.env'), resolve(here, '..', '.env')]) {
    if (!existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
    } catch {
      // ignore unreadable files
    }
  }
}
