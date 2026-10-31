// Bundles each Lambda entry point into dist/<name>/index.mjs (one zip per function).
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

const handlers = ['api', 'finalize'];
rmSync('dist', { recursive: true, force: true });

await Promise.all(
  handlers.map((name) =>
    build({
      entryPoints: [`src/handlers/${name}.ts`],
      outfile: `dist/${name}/index.mjs`,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      sourcemap: false,
      minify: true,
      legalComments: 'none',
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      logLevel: 'info',
    }),
  ),
);
