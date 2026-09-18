import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The example ships as a set of static files that may be served from a sub-path,
// so every asset URL is emitted relative to index.html.
export default defineConfig({
  base: './',
  plugins: [react()],

  server: {
    port: 3000,
    open: true,
  },
  preview: {
    port: 3000,
  },

  test: {
    globals: true,
    // e2e/ is Playwright's; Vitest must not try to run those specs.
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    css: true,
  },
});
