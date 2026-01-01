import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

// Read API port from .ports file (created by scripts/dev.sh)
function getApiPort(): number {
  const portsFile = resolve(__dirname, '../.ports');
  if (existsSync(portsFile)) {
    const content = readFileSync(portsFile, 'utf-8');
    const match = content.match(/^API=(\d+)/m);
    if (match) return parseInt(match[1], 10);
  }
  // Fallback to environment variable or default
  return parseInt(process.env.PORT || '3000', 10);
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiPort = getApiPort();

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    server: {
      port: parseInt(env.VITE_PORT || '5173'),
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        '/collaboration': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
