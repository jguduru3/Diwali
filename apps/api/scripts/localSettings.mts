import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Copies Values from local.settings.json into process.env for CLI scripts (env wins). */
export function loadLocalSettings(): void {
  const file = resolve(import.meta.dirname, '..', 'local.settings.json');
  if (!existsSync(file)) return;
  const values = (JSON.parse(readFileSync(file, 'utf8')) as { Values?: Record<string, string> })
    .Values;
  for (const [k, v] of Object.entries(values ?? {})) process.env[k] ??= v;
}
