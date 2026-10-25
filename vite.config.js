import { defineConfig } from 'vite';

// BASE_PATH: sottocartella di pubblicazione (es. /forklift-tycoon/ su GitHub Pages)
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 6000,
    // Mappe del codice solo per il sito (nell'app Android peserebbero 24 MB inutili)
    sourcemap: !!process.env.BASE_PATH,
  },
});
