import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * The client lives in `client/` and always builds to `client/dist`, which the
 * Express server serves with an SPA catch-all (single deployable unit on :5000).
 */
export default defineConfig({
  root: path.resolve(import.meta.dirname, 'client'),
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'client/dist'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        /**
         * Recharts + d3 are only reachable from lazily-loaded routes, so they are
         * pinned into their own chunk and never counted in the entry payload.
         */
        manualChunks(id) {
          if (id.includes('node_modules') && (id.includes('recharts') || id.includes('/d3-') || id.includes('victory-vendor'))) {
            return 'charts';
          }
          return undefined;
        },
      },
    },
  },
});
