import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const __filename=fileURLToPath(import.meta.url);const __dirname=path.dirname(__filename);const buildId=(process.env.GITHUB_SHA||'local').slice(0,12);
export default defineConfig({
  plugins:[react(),VitePWA({
    strategies:'injectManifest',srcDir:'src',filename:'sw.ts',injectRegister:false,registerType:'prompt',manifest:false,
    devOptions:{enabled:false},injectManifest:{globPatterns:['**/*.{js,css,html,ico,png,svg,woff2}']}
  })],
  resolve:{alias:{'@':path.resolve(__dirname,'./src')}},
  build:{outDir:'dist',sourcemap:false,rollupOptions:{output:{inlineDynamicImports:true,entryFileNames:`assets/[name]-${buildId}-[hash].js`,chunkFileNames:`assets/[name]-${buildId}-[hash].js`,assetFileNames:`assets/[name]-${buildId}-[hash][extname]`}}}
});