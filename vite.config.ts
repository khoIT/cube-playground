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
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
  },
  server: {
    port: 3000,
    proxy: {
      '^/playground/.*': 'http://localhost:4000',
      '^/cubejs-api/.*': 'http://localhost:4000',
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
