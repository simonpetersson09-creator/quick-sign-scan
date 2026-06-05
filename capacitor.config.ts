import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor laddar appen via WKWebView. Eftersom projektet är en TanStack Start
// SSR-app fungerar det inte att paketera en statisk SPA-shell — vi pekar
// istället WKWebView mot den publicerade webb-appen. Layout, routing,
// CSS och safe areas fungerar då exakt som på webben.
//
// Med CAP_DEV=1 körs mot Lovable preview (hot reload), annars mot prod.
const isDev = process.env.CAP_DEV === '1';

const PROD_URL =
  'https://quick-sign-scan.lovable.app?forceHideBadge=true';
const DEV_URL =
  'https://69a35b64-3eb9-4e68-8e67-6b39a3a3ec0e.lovableproject.com?forceHideBadge=true';

const config: CapacitorConfig = {
  appId: 'com.sspp.signandgo',
  appName: 'Sign & Go',
  webDir: 'dist/client',
  server: {
    url: isDev ? DEV_URL : PROD_URL,
    cleartext: false,
  },
  ios: {
    contentInset: 'always',
  },
};

export default config;
