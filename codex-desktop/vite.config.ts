import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  // Use relative paths so the renderer works when loaded via file://
  // in the packaged Electron app (otherwise assets resolve to /assets/* and fail).
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'build/renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
