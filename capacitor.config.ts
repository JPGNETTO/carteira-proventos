import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.netto.carteiraproventos',
  appName: 'Carteira Proventos',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Permite tráfego HTTP (sem TLS) — o AI Bridge roda em http:// via Tailscale/LAN
    cleartext: true
  },
  android: {
    backgroundColor: '#0a0a14',
    // O app roda em https://localhost; sem isto o WebView BLOQUEIA chamadas a http://
    // (conteúdo misto) e a IA/cotações ficam "sem resposta"
    allowMixedContent: true
  }
};

export default config;
