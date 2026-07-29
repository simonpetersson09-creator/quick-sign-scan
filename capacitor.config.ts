import type { CapacitorConfig } from '@capacitor/cli';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// iOS / Capacitor laddar appen lokalt från `webDir`. Vi pre-renderar en
// SPA-shell via TanStack Starts inbyggda SPA-läge (se vite.config.ts) som
// skriver en `index.html` i Nitros klient-output. Inga remote-URLs — appen
// körs helt från det paketerade bundlet i WKWebView.
//
// Beroende på Nitro-version/preset hamnar klient-outputen antingen i
// `.output/public` (Nitros default) eller i `dist/client`. Vi väljer den
// katalog som faktiskt genererades, så `npx cap sync ios` fungerar i båda
// fallen.
//
// Server-anrop (createServerFn → /_serverFn/*) routas vidare till den
// publicerade Workern via src/lib/capacitor-fetch.ts, så det är endast
// API-trafiken som går ut på nätet — UI:t är native-bundlat.

const webDirCandidates = ['.output/public', 'dist/client'];
const webDir =
  webDirCandidates.find((dir) => existsSync(resolve(process.cwd(), dir, 'index.html'))) ??
  webDirCandidates[0];

const config: CapacitorConfig = {
  appId: 'com.sspp.signandgo',
  appName: 'Sign & Go',
  webDir,
  // Fyll även ytan bakom/i utkanten av WKWebView. Det tar bort svart bottenyta
  // vid iOS home-indicator när CSS-vyn slutar före safe area.
  backgroundColor: '#d4ccbe',
  ios: {
    backgroundColor: '#d4ccbe',
    // Safe area hanteras i CSS med viewport-fit=cover + .pt-safe/.pb-safe.
    // Native auto-inset skapar annars en separat bottenyta i scroll-vyn.
    contentInset: 'never',
    // Tillåt mixed content är inte nödvändigt — alla externa anrop är https.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    StatusBar: {
      // Matchar appens varma bakgrundsfärg (--background ≈ #d4ccbe) så
      // statusfältet smälter in istället för att bli svart eller vitt.
      style: 'LIGHT',
      backgroundColor: '#d4ccbe',
      overlaysWebView: true,
    },
    Keyboard: {
      // Native-resize gör att WebView krymper när tangentbordet är uppe,
      // så fokuserade inputs inte hamnar bakom det.
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
