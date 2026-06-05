import type { CapacitorConfig } from '@capacitor/cli';

// iOS / Capacitor laddar appen lokalt från `webDir`. Vi pre-renderar en
// SPA-shell via TanStack Starts inbyggda SPA-läge (se vite.config.ts) som
// skriver `dist/client/index.html`. Inga remote-URLs — appen körs helt
// från det paketerade bundlet i WKWebView.
//
// Server-anrop (createServerFn → /_serverFn/*) routas vidare till den
// publicerade Workern via src/lib/capacitor-fetch.ts, så det är endast
// API-trafiken som går ut på nätet — UI:t är native-bundlat.

const config: CapacitorConfig = {
  appId: 'com.sspp.signandgo',
  appName: 'Sign & Go',
  webDir: 'dist/client',
  ios: {
    contentInset: 'always',
    // Tillåt mixed content är inte nödvändigt — alla externa anrop är https.
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
