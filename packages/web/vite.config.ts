import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/admin': 'http://localhost:3000',
      '/webhook': 'http://localhost:3000',
      '/stripe': 'http://localhost:3000',
      '/files': 'http://localhost:3000',
    },
  },
});