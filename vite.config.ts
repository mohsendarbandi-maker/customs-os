import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      registerType: 'prompt',
      manifest: false,
      devOptions: {enabled: false},
      injectManifest: {
        globPatterns: ['**/*.{js,css,ico,png,svg,woff2,webmanifest}'],
        globIgnores: ['**/*.html', 'offline.html'],
      },
    }),
  ],
  resolve: {alias: {'@': path.resolve(__dirname, './src')}},
  build: {outDir: 'dist', sourcemap: false},
});
