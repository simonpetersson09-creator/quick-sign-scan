## Mål
Skanningar i klass med Microsoft Lens / Adobe Scan:
- Pappret blir **helt rakt** (perspektiv-korrigerat)
- Bakgrunden (bord, trä, skugga) **helt borta**
- **All text bevaras** – även smått i sidfot/sidhuvud
- Pappret blir **rent vitt** utan att radera text

## Problemanalys (varför det blivit fel hittills)
Vi har pendlat mellan två fel:
1. **För aggressiv rensning** (`cleanPaperEdges`, `enhancePaper`, `removeShadows`, hård deskew) → text försvinner.
2. **Ingen rensning alls** → bakgrund/träkanter syns runt pappret.

Roten är att **kantdetekteringen är osäker**. När hörnen sitter någon mm utanför pappret räcker det inte med marginal-trick – då måste vi antingen visa bakgrund eller skala bort text. Lens löser detta genom:
- En **mycket bättre hörndetektering** (multi-skala + verifiering)
- En **separat "vitgörning"** som bara påverkar bakgrunden, inte text
- **Ingen** efter-deskew som skalar om bilden

## Förslag – 4 steg

### 1. Robust hörndetektering (största vinsten)
Ersätt nuvarande quad-detection med en flerstegspipeline i `src/lib/perspective.ts`:
- Nedskalning till ~1024 px för snabb analys
- **Adaptiv tröskling** (Sauvola/Otsu) istället för enbart Canny – fungerar på vita papper mot ljusa bord
- Hitta största 4-hörniga konturen med rätt aspect ratio (~√2 för A4)
- **Hörnförfining ("corner refinement")**: för varje hittat hörn, sök inom ±20 px efter den faktiska kantövergången → hörn hamnar exakt på papperskanten
- Fallback till nuvarande detector om inget hittas

Resultat: hörnen sitter pixel-exakt på pappret → ingen marginal behövs → ingen träkant, ingen bortskuren text.

### 2. Ta bort EDGE_MARGIN-hacket
Med exakta hörn kan `EDGE_MARGIN` sättas till `0`. Vi varken växer (bakgrund) eller krymper (text bort).

### 3. "Smart whitening" istället för shadow removal
Ny funktion `whitenBackground` i `src/lib/perspective.ts` som:
- Beräknar lokal bakgrundsnivå (stor box-blur, ~5% av bildbredd)
- Dividerar bilden med bakgrunden (klassisk "flat-field correction" – samma teknik Lens/CamScanner använder)
- Gör pappret jämnvitt **utan** att röra mörka pixlar (text förblir svart och skarp)
- Mild kontrastkurva (gamma ~0.95), ingen tröskling

Detta ersätter de gamla `enhancePaper`/`removeShadows` som åt upp text.

### 4. Behåll hög JPEG-kvalitet, ingen efter-deskew
- `JPEG_QUALITY = 0.95` (redan satt)
- **Ingen** `autoOrientAndDeskewDocument` efter warp – perspektivkorrigeringen räcker, extra rotation = omsampling = suddig text
- `renderToA4Portrait` använder `Math.max` (redan satt) så ingen vit kant

## Filer som ändras
- `src/lib/perspective.ts` – ny hörndetektering + `whitenBackground`
- `src/routes/scan.tsx` – `EDGE_MARGIN = 0`, anropa `whitenBackground` efter warp
- `src/routes/preview.tsx` – sätt "Smart vit" som standardfilter

## Vad detta INTE gör
- Inget OCR (kan läggas till senare)
- Ingen ML-modell – allt körs i Canvas/JS, samma stack som idag
- Ingen extern dependency

Vill du att jag kör hela paketet, eller börjar med steg 1 (kantdetekteringen) först och utvärderar?