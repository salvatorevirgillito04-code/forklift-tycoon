import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

// BASE_PATH: sottocartella di pubblicazione (es. /forklift-tycoon/ su GitHub Pages)
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  // Versione e data di compilazione, mostrate nel menu sviluppatore
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 6000,
    // Mappe del codice solo per il sito (nell'app Android peserebbero 24 MB inutili)
    sourcemap: !!process.env.BASE_PATH,
  },
});
