# iOS App Icon

Källikonen ligger i `resources/icon.png` (1024×1024, ifylld med bakgrundsfärgen
`#d4ccbe` så hörnen inte blir vita när iOS maskar ikonen).

## Installera ikonen i din lokala iOS-build

Eftersom `ios/`-mappen skapas lokalt på Macen via `npx cap add ios`, finns
inte `Assets.xcassets` i Lovable-repo:t. En färdig `AppIcon.appiconset` med
alla storlekar är genererad i `ios-icons/AppIcon.appiconset/`.

### Alternativ A – kopiera in den färdiga appiconset (snabbast)

```bash
rm -rf ios/App/App/Assets.xcassets/AppIcon.appiconset
cp -R ios-icons/AppIcon.appiconset ios/App/App/Assets.xcassets/
npx cap sync ios
```

Öppna sedan i Xcode (`npx cap open ios`) → Archive → ladda upp till TestFlight.

### Alternativ B – generera om från källan med `@capacitor/assets`

```bash
bun add -D @capacitor/assets
npx capacitor-assets generate --ios
npx cap sync ios
```

Detta läser `resources/icon.png` och skriver om hela appiconset automatiskt.
Använd när du vill uppdatera ikonen senare – byt bara ut `resources/icon.png`
och kör kommandot igen.
