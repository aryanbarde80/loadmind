import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(configDir, './src') },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Allow the sandboxed preview host (*.e2b.app) and any tunnel host.
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](?:react|react-dom)(?:[\\/]|$)/, priority: 20 },
            { name: 'charts', test: /node_modules[\\/](?:recharts|d3-[^\\/]+|victory-vendor)(?:[\\/]|$)/, priority: 10 },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/, priority: 5 },
          ],
        },
      },
    },
  },
  worker: { format: 'es' },
});
