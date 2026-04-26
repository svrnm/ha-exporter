import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy forwards API traffic to the Node server running on :8080, so the
// browser only talks to Vite (on :5173) during development and there are no
// CORS headaches.
const API_PATHS = [
  '/health',
  '/ingest',
  '/instances',
  '/entities',
  '/statistics',
  '/states',
  '/energy',
];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      API_PATHS.map((p) => [p, { target: 'http://localhost:8080', changeOrigin: false }]),
    ),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
