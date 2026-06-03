import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.69a35b643eb94e688e676b39a3a3ec0e',
  appName: 'Scan & Sign',
  webDir: 'dist',
  server: {
    // För hot-reload mot Lovable preview under utveckling.
    // Ta bort eller kommentera ut detta innan du bygger en release-IPA för App Store.
    url: 'https://69a35b64-3eb9-4e68-8e67-6b39a3a3ec0e.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  ios: {
    contentInset: 'always',
  },
};

export default config;
