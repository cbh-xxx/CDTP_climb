import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
const proxy = {
  '/test-api': { target: 'http://127.0.0.1:3002', changeOrigin: false, rewrite: (path: string) => path.replace(/^\/test-api/, '') },
  '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false, rewrite: (path: string) => path.replace(/^\/api/, '') },
};

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __TEST_BUILD__: JSON.stringify(mode === 'testing') },
  build: { outDir: mode === 'testing' ? 'dist-test' : 'dist' },
  server: { host: '127.0.0.1', proxy },
  preview: { proxy },
  test: { include: ['src/**/*.test.ts', 'integration/**/*.test.ts'], environment: 'node' },
}));
