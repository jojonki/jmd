import { createRequire } from 'node:module';
import { defineConfig } from 'vite';

const { version } = createRequire(import.meta.url)('./package.json');

export default defineConfig({
  // Electron loads the build output from disk, so every asset URL must be relative.
  base: './',
  // The About dialog shows the same version electron-builder stamps on the app.
  define: { __APP_VERSION__: JSON.stringify(version) },
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
