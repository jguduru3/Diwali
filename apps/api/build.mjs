// Bundles every function (plus @pataka/shared) into dist/index.js so the deploy
// zip needs no workspace packages and each worker opens a single DB pool.
import { rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
// Fresh output for one-off builds; the dev watcher rebuilds in place while the host runs.
if (!watch) rmSync('dist', { recursive: true, force: true });

const options = {
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  // functions-core is injected by the Functions host at runtime
  external: ['pg-native', '@azure/functions-core'],
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
