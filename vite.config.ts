import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { schemaWriteMiddleware } from './vite-plugins/schema-write-middleware.js';
import { cdpMockMiddleware } from './vite-plugins/cdp-mock-middleware.js';

export default defineConfig(({ mode }) => {
  // Vite plugins run in Node and don't get `import.meta.env`. Load .env files
  // explicitly so server-side code can read VITE_CUBE_MODEL_DIR etc.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['VITE_CUBE_MODEL_DIR', 'VITE_CUBE_API_URL', 'VITE_CUBE_TOKEN']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }

  return {
  // Absolute base so asset URLs resolve from the site root at ANY route depth.
  // A relative base ('./') breaks deep non-hash routes under nginx: at
  // /auth/callback the browser resolves ./assets/* to /auth/assets/*, which the
  // SPA fallback serves as index.html (text/html) → module-script MIME error →
  // the app never boots to process the OAuth code. The app is always served
  // from root (dev :3000, prod nginx), so '/' is correct for both.
  base: '/',
  build: {
    outDir: 'dist',
    target: 'es2020',
    // Sourcemaps are opt-in: stitching maps for ~9k modules is the single most
    // expensive (single-threaded, memory-hungry) part of the bundle and is
    // wasted work on local docker builds. Prod CI passes BUILD_SOURCEMAP=true
    // (compose build arg) so deployed stack traces stay readable.
    sourcemap: process.env.BUILD_SOURCEMAP === 'true',
  },
  server: {
    port: 3000,
    proxy: {
      '^/playground/.*': 'http://localhost:4000',
      // Legacy direct-to-Cube path (kept for non-workspace-aware callers).
      '^/cubejs-api/.*': 'http://localhost:4000',
      // Workspace-aware Cube proxy: routes through Fastify so the active
      // x-cube-workspace header decides which Cube backend handles the call.
      '/cube-api': { target: 'http://localhost:3004', changeOrigin: true },
      '/api': { target: 'http://localhost:3004', changeOrigin: true },
    },
  },
  plugins: [
    react(),
    ...(mode === 'development' ? [schemaWriteMiddleware(), cdpMockMiddleware()] : []),
  ],
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
        additionalData: '@root-entry-name: default;',
      },
    },
  },
  define: {
    'process.env.SC_DISABLE_SPEEDY': JSON.stringify('false'),
    ...(mode === 'development' ? { global: {} } : {}),
  },
  };
});
