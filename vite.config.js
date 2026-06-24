import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Caminhos relativos — necessário para o WebView do Capacitor
    assetsDir: 'assets',
  },
  base: './',
});
