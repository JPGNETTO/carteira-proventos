import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Plugins nativos do Capacitor: resolvidos em runtime dentro do APK.
// No navegador (dev-server e preview no PC) eles não existem, então o app
// usa import() dinâmico protegido por try/catch e cai no fallback web.
const capacitorNativos = [
  '@capacitor/share',
  '@capacitor/filesystem',
  '@capacitor/haptics',
  '@capacitor-community/speech-recognition',
  '@capacitor-community/text-to-speech',
];

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: './',
  // Só no dev-server (rodando no PC) evitamos que o esbuild tente pré-empacotar
  // os plugins nativos — é o que causava "Could not resolve @capacitor/core".
  optimizeDeps: {
    exclude: capacitorNativos,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
}));
