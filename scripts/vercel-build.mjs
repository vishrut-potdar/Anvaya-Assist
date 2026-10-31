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

// Project env vars are available to this build step; copy the database ones into the function's
// config too, so the API sees them at runtime even if Vercel doesn't attach them to prebuilt functions.
const dbEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k, v]) => v && /^(DATABASE_URL|POSTGRES_URL)$/.test(k))
);
console.log(
  'Database env vars visible to the build (names only):',
  Object.keys(process.env).filter((k) => /DATABASE|POSTGRES|^PG|NEON/i.test(k)).sort().join(', ') || 'none',
  `(VERCEL_ENV=${process.env.VERCEL_ENV || 'unset'})`
);

fs.writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({
    runtime: 'nodejs22.x',
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
    maxDuration: 60,
    environment: dbEnv,
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
