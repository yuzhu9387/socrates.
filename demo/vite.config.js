import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig(({ mode }) => ({
  plugins: mode === 'app' ? [] : [viteSingleFile()],
  server: { proxy: { '/api': 'http://127.0.0.1:3001', '/mcp': 'http://127.0.0.1:3001' } },
  build: { assetsInlineLimit: mode === 'app' ? 4096 : 10000000, chunkSizeWarningLimit: 5000 },
}));
