import { defineConfig } from 'vite';

export default defineConfig({
  // Electron loads the build output from disk, so every asset URL must be relative.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
