import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  // Relative asset URLs: the app is served below a configurable BASE_PATH.
  base: './',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
});
