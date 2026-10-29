import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __TEST_BUILD__: JSON.stringify(mode === 'testing') },
  build: { outDir: mode === 'testing' ? 'dist-test' : 'dist' },
  server: { host: '127.0.0.1' },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
}));
