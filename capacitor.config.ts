import type { CapacitorConfig } from '@capacitor/cli';

// Sätt CAP_DEV=1 i terminalen för att köra mot Lovable preview (hot reload):
//   CAP_DEV=1 npx cap sync ios
// Standard (utan flagga) bygger för release/App Store och kör inbyggd webbkod.
const isDev = process.env.CAP_DEV === '1';

const config: CapacitorConfig = {
  // Reverse-DNS bundle id. Kan INTE ändras efter första App Store-uppladdning.
  appId: 'com.sspp.signandgo',
  appName: 'Sign & Go',
  webDir: 'dist',
  ...(isDev
    ? {
        server: {
          url: 'https://69a35b64-3eb9-4e68-8e67-6b39a3a3ec0e.lovableproject.com?forceHideBadge=true',
          cleartext: true,
        },
      }
    : {}),
  ios: {
    contentInset: 'always',
  },
};

export default config;
