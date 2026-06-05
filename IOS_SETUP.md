# Bygga som native iOS-app (App Store)

Lovable bygger webbappen. För att paketera den som en native iOS-app använder vi **Capacitor**. Det gör vi **utanför Lovable**, på en Mac med Xcode.

## Förutsättningar
- Mac med **Xcode** (senaste versionen, från Mac App Store)
- **Apple Developer-konto** (99 USD/år) — krävs för App Store och för att testa på riktig iPhone
- **Node.js + npm/bun** installerat
- **CocoaPods**: `sudo gem install cocoapods` (eller `brew install cocoapods`)

## Steg 1: Exportera projektet från Lovable
1. I Lovable → GitHub → "Export to GitHub" (eller använd "Connect to GitHub")
2. Klona ditt repo lokalt på Macen:
   ```bash
   git clone <ditt-repo-url>
   cd <ditt-repo>
   bun install   # eller npm install
   ```

## Steg 2: Lägg till Capacitor och iOS-plattformen
```bash
bun add @capacitor/core @capacitor/ios
bun add -D @capacitor/cli
npx cap add ios
```

`capacitor.config.ts` ligger redan i repo:t.

## Steg 3: Bygg webbappen och synka till iOS
```bash
bun run build
npx cap sync ios
```

## Steg 4: Öppna i Xcode
```bash
npx cap open ios
```

I Xcode:
1. Välj projektet i sidopanelen → **Signing & Capabilities** → välj ditt **Team** (Apple Developer-kontot)
2. Sätt en unik **Bundle Identifier** (t.ex. `com.dittforetag.scansign`)

### Lägg till kamerabehörighet (OBLIGATORISKT — annars kraschar appen + App Store reject)

Öppna `ios/App/App/Info.plist` (i Xcode eller valfri editor) och lägg till **innan** `</dict>` i slutet:

```xml
<key>NSCameraUsageDescription</key>
<string>Appen behöver tillgång till kameran för att skanna dokument.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Tillåt åtkomst för att välja dokumentbilder från fotobiblioteket.</string>
```

## Steg 5: Testa på iPhone
- Anslut iPhone via USB → välj enheten i Xcode → tryck **Play (▶)**
- Första gången måste du godkänna utvecklarprofilen på iPhone (Inställningar → Allmänt → VPN och enhetshantering)

## Steg 6: Skicka till App Store
1. **Bygg release** med access-koden inbakad så iOS-appen kan anropa serverfunktionerna utan att be användaren om kod:
   ```bash
   VITE_APP_ACCESS_CODE=<samma kod som APP_ACCESS_CODE-secret i Lovable Cloud> \
   bun run build && npx cap sync ios
   ```
   - `VITE_APP_ACCESS_CODE` får ALDRIG sättas när du bygger den publika webbversionen (då hamnar koden i den nedladdningsbara JS-bundlen på lovable.app). Den ska bara sättas lokalt när du gör Capacitor-bygget.
   - Värdet måste matcha `APP_ACCESS_CODE`-secret som finns i Lovable Cloud. Vill du rotera koden: uppdatera secret → bygg om iOS-appen med det nya värdet → publicera ny TestFlight/App Store-version. Webbanvändare matar in den nya koden manuellt i gate-rutan vid nästa besök.
   - För dev mot Lovable preview-server: `CAP_DEV=1 VITE_APP_ACCESS_CODE=<code> npx cap sync ios`.
2. I Xcode: **Product → Archive** → **Distribute App** → **App Store Connect**
3. Logga in på [App Store Connect](https://appstoreconnect.apple.com) och fyll i metadata (namn, ikoner, screenshots, beskrivning, integritetspolicy, support-URL)
4. Skicka in för granskning (tar normalt 1–3 dagar)

## Vad är förberett i Lovable
- ✅ `capacitor.config.ts` med `appId`, `appName`, `webDir: dist`
- ✅ Mobile-first UI med safe areas (`pt-safe` / `pb-safe`)
- ✅ Kamera via `getUserMedia` — fungerar i WKWebView med `NSCameraUsageDescription`
- ✅ Ingen serverlagring av dokument/signaturer (matchar Apples integritetskrav)

## Tips
- För **native kameraplugin** (bättre kvalitet, dokumentskanner-stil): `bun add @capacitor/camera` — kan ersätta `getUserMedia`-flödet senare
- För **Face ID / Touch ID**: `bun add @capacitor-community/biometric-auth`
- För att uppdatera appen efter ändringar i Lovable: `git pull && bun run build && npx cap sync ios` → Archive på nytt
