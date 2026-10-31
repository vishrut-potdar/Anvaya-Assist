// Builds .vercel/output (Vercel Build Output API v3):
//   static/        <- Vite frontend
//   functions/api  <- Express API bundled into one Node function
// Vercel only serves static files for a plain Vite build, so without this the /api routes 404.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const out = '.vercel/output';
const fn = `${out}/functions/api.func`;

fs.rmSync(out, { recursive: true, force: true });
execSync('npx vite build', { stdio: 'inherit' });
fs.cpSync('dist', `${out}/static`, { recursive: true });

await build({
  entryPoints: ['src/server/app.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // PGlite loads its wasm/data files relative to its own module, so ship it unbundled
  external: ['@electric-sql/pglite', 'pg-native'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
fs.cpSync('node_modules/@electric-sql/pglite', `${fn}/node_modules/@electric-sql/pglite`, { recursive: true });

fs.writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({
    runtime: 'nodejs22.x',
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
    maxDuration: 60,
  })
);

fs.writeFileSync(
  `${out}/config.json`,
  JSON.stringify({
    version: 3,
    routes: [
      { src: '^/(api(/.*)?|health)$', dest: '/api' },
      { handle: 'filesystem' },
      { src: '/(.*)', dest: '/index.html' },
    ],
  })
);

console.log('Vercel build output ready in', out);
