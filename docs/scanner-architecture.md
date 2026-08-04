# Sign & Go — Skannerpipeline, teknisk arkitektur

Status: beskrivning av nuvarande kod (ingen kod ändrad).
Huvudfiler: `src/routes/scan.tsx` (~3795 rader), `src/lib/perspective.ts` (~4625 rader),
`src/lib/detect.worker.ts` (35 rader), `src/lib/pdf.ts`.

---

## 1. Kamerastart

**Syfte:** etablera en stabil, skarp och korrekt exponerad videoström och starta
detekteringsslingan i ett känt, nollställt tillstånd.

**Sekvens** (`scan.tsx:742-1000`)

1. **Full state-reset** (`752-799`) — körs vid *varje* `startCamera()`, alltså även
   vid "Skanna fler sidor". Nollställer ~40 refs (se avsnitt 8).
2. **Miljökontroller** — `window.isSecureContext` (`812`), `mediaDevices`-stöd och
   iframe-detektering (`820-826`).
3. **Permission-preflight** — `navigator.permissions.query({name:"camera"})` (`835`);
   `denied` kortsluter till felstatus (`850-854`).
4. **getUserMedia** (`861-869`):
   `facingMode: {ideal:"environment"}`, `width:{ideal:3840}`, `height:{ideal:2160}`,
   `focusMode:"continuous"` (icke-standard). Race mot **15000 ms** timeout (`871-878`).
5. **Track-constraints** (`891-907`) — appliceras bara om kapabiliteten stödjer
   `"continuous"`: `focusMode`, `exposureMode`, `whiteBalanceMode`.
   Kapabiliteter cachas i `trackCapsRef`; `torchAvailable` sätts från `caps.torch`.
6. **Videoelement** — `srcObject`, väntar `loadedmetadata`/`canplay` + `videoWidth>0`
   (`920-942`), `play()` (`944`), race mot **4000 ms** timeout (`950`).
7. **Första riktiga frame** — `requestVideoFrameCallback` med rAF-fallback och
   **1500 ms** säkerhetstimeout (`957-977`).
8. **Warm-up-arming** (`986`): `armedAtRef = now + CAMERA_WARMUP_MS (1200 ms)`,
   räknat från *första dekodade frame*, inte från anropstidpunkten. Auto-capture kan
   inte utlösas före det — AF/AE hinner konvergera.
9. `setCameraReady(true)` → `setStatus("searching")` → `loop()` (`999-1000`).

**Motion permission** hanteras i mount-effekten (`1044-1125`), inte i `startCamera`:
`granted` → lyssna direkt; `pending` → polla 250 ms upp till 8 s; `unknown` →
best-effort request + polla upp till 4 s; `denied`/`unsupported` → hoppa över.
Gyrot är alltså **valfritt** — pipelinen fungerar utan, men med striktare trösklar.

**Worker-start:** lat skapad i `getDetectWorker()` (`384-413`), `type:"module"`.

**Styrkor:** deterministisk återstart (identiskt state sida 2 som sida 1); warm-up
mätt från riktig frame; alla väntetider har timeout så vyn aldrig hänger.

**Svagheter:** `detectWorkerFailedRef` och `detectReqIdRef` ingår **inte** i reset-blocket
— en worker som fallerat en gång förblir avstängd resten av sessionen. Ingen explicit
autofokus-trigger (bara `continuous`), så pipelinen litar helt på kamerans egen AF.

---

## 2. Live-detektering

### 2.1 Slingan

`loop()` (`1127-1139`) är en rAF-loop som throttlar `detect()` till
`DETECT_INTERVAL_MS = 45` (~22 Hz). Detect-framen ritas ned till
`DETECT_WIDTH = 416` px (`ENABLE_DETECT_HIRES`, annars 280), höjd proportionell.

`frameWeight = clamp(dt / NOMINAL_FRAME_MS(40), 0.25, 4)` (`1152-1159`) gör
stabilitetströsklarna tidsbaserade istället för framebaserade — 15 "frames" betyder
~600 ms oavsett hur snabbt enheten hinner detektera.

### 2.2 `detectDocumentQuad` (`perspective.ts:755-1032`)

**Förbehandling:** BT.601-luma + 256-binshistogram (`770-780`); krominansproxy
`max−min` när `ENABLE_WHITENESS_CHANNEL` (true); `stretchContrast` 2/98-percentil
(hoppas över om span ≥170 eller <20); 3×3 gaussisk blur.

**Canny** (`1411-1511`): Sobel, 4-vägs NMS, hög tröskel = **78:e percentilen** av
gradienthistogrammet (golv 22), låg tröskel = `hög × 0.38`, hysteres via flood fill.

**Morfologi:** separabel `morphH`/`morphV` (O(1) per pixel) — stängning r=1 på kanter,
r=3 på pappersmasker.

**Kandidatgenerering:**
- `brightThreshold = clamp(70, 225, otsu + 8)`
- `buildBrightPaperMask` (luma ≥ tröskel) och `buildWhitenessMask`
  (luma ≥ max(60, tröskel−25) **och** krominans ≤ 22)
- komponenter → convex hull → RDP vid epsilon `[0.012, 0.02, 0.032, 0.05, 0.075, 0.1] × omkrets`
  + `reduceHullToQuad` + bbox-fallback, dedupe mot 2 px-rutnät
- Hough-linjer finns (`houghLineQuadCandidates`) men är **avstängd** (`ENABLE_HOUGH_LINE_DETECTION = false`).

**Kandidatgrindar** (`evaluateEdgeQuad`, `1857-2125`), i ordning:
konvexitet → kantsnap (`refineQuadToEdges`, 28 samples/sida, sökradie
`max(6, minDim×0.04)`, robust linjefit med MAD-outlierbort) → `touchesFrameEdge`
(3 px marginal) → `fillsEntireFrame` (20 px) → area `0.04–0.95` → A4-fel `ratioError ≤ 0.35`
→ perspektivfel ≤ 4.5 → sidavvikelse ≤ 0.22 → polygonfyllnad 0.45–2.4.

**Strikta capture-grindar** (första felet blir `reasonNotReady`):
`edgeScore < 0.18`, `mean < 135`, `brightRatio < 0.55`, `darkRatio > 0.32`,
`mean − exteriorMean < 12`, `edgeTightness < tröskel` (0.45, eller 0.34 adaptivt för
små dokument), samt `weakSideSupport` — minsta per-sida-tightness < **0.25**.

**Confidence** (`1964-1975`, vikter summerar till 1.0):

```
0.22·edgeScore + 0.12·straightScore + 0.06·a4Score + 0.06·brightnessScore
+ 0.04·textScore + 0.06·perspectiveScore + 0.05·areaScore + 0.07·contrastScore
+ 0.07·purityScore + 0.25·edgeTightness
```

`edgeTightness` är alltså den enskilt tyngsta termen.

**Yttre omrankning** — `filterOuterDetections` (`1046-1070`) tar bort kandidater som
ligger inuti en ≥1.087× större kandidat. Kvarvarande rankas om med `outerConfidence`
(`971-978`):

```
0.38·areaScore + 0.18·a4Score + 0.12·edgeScore + 0.06·bgContrastScore
+ 0.04·centerScore + 0.14·confidence + 0.08·tempScore
```

Här mättar `areaScore` vid **60 %** framefyllnad, och `tempScore` är enbart
centroidavstånd till `preferQuad` (ingen IoU, ingen area-penalty).
`insideOutsideLuma` hårdavvisar kandidater med luma-gap < 10 (`innerTextBlock`).

Slutlig acceptans kräver `confidence ≥ MIN_DOCUMENT_CONFIDENCE = 0.12`.
Faller den, returneras vid `allowOverlay` en overlay-kandidat med
`readyForCapture: false` + `reasonNotReady` — det som ritas som "generös ram".

### 2.3 preferQuad, smoothQuad, outlier, lock

- **preferQuad** (`scan.tsx:1191-1217`) = föregående `smoothQuad` skalad till
  detect-pixlar. `ENABLE_PREFER_BIAS_GATE = false` ⇒ bias är permanent på, utom när
  `biasDecayed` (≥ `OUTLIER_BIAS_DECAY_FRAMES = 6` raka förkastade frames).
  Bias påverkar **bara scoring**, aldrig sökregionen — hela framen scannas alltid.
- **Outlier-grind** (`1498-1533`): `rawDelta = maxCornerDelta(norm, smooth)`.
  `> OUTLIER_DELTA (0.13)` och `< LOCK_BREAK_DELTA (0.20)` ⇒ frame förkastas, **utom**
  när `isOutwardExpansion()` (≥2 % större yta, inget hörn inåt mer än 0.004, confidence
  ≥ 0.45) — då släpps expansionen igenom. `≥ 0.20` i >3 raka frames bryter låset.
- **EMA:** `emaQuad` med `ALPHA_PRE_LOCK = 0.18` / `ALPHA_POST_LOCK = 0.07`.
- **Röstning:** `recentSmoothQuadsRef`, fönster `QUAD_VOTE_WINDOW = 7` (används bara vid `?voting=1`).
- **Lock:** `lockedRef = true` när `captureStableCount ≥ readyTarget` och bild är skarp + ljus nog.

**Styrkor:** flerkanalig kandidatgenerering (kant + ljushet + vithet) ger robusthet mot
låg kontrast; scoringen är pro-expansion; overlay-vägen ger användaren feedback långt
innan strikta grindar passerar.

**Svagheter:** två olika `areaScore`/`a4Score`-formler (inre vs yttre scoring) med olika
skalning gör beteendet svårt att resonera om; ~25 hårdkodade trösklar utan gemensam
kalibreringspunkt; `tempScore` använder bara centroid, vilket gör temporal bias
formokänslig.

---

## 3. Hörnförfining

| Funktion | Körs när | Fönster/band | Max flytt | Riktning |
|---|---|---|---|---|
| `refineQuadToEdges` (`2163-2332`) | inuti varje kandidatutvärdering | sökradie `max(6, minDim·0.04)` | linjefit | symmetrisk |
| `refineQuadCorners` (`3141-3212`) | vid capture (och live om `ENABLE_LIVE_CORNER_REFINE`, som är false) | 21×21 px | **±5 px** | +0.5 px utåtbias |
| `snapQuadToPaperEdges` (`3351-3542`) | vid capture (av med `?noSnapQuad=1`) | band `shortSide·0.023` | `shortSide·0.012` | **endast utåt** |

`refineQuadCorners` är en gradientviktad centroid inom fönstret, no-op om ingen
gradient > 30 hittas. `snapQuadToPaperEdges` kräver att ≥40 % av 20 samplade kolumner
hittar en gradient ≥14 och att medianstyrkan är ≥1.3× styrkan på nuvarande linje;
inåtsnap är förbjudet (textrader precis innanför kanten ser ut som pappersgränser).
Skyddsnät: flyttar något hörn mer än 2× max, förkastas hela snappen.

**Orientering:** `orientQuadForA4Portrait` (`275-396`) provar alla fyra cykliska
rotationer, miniatyrwarpar var och en och poängsätter med `estimateTextSkew`; kräver
marginal ≥1.15 (≥1.25 för 180°) för att rotera bort från nuvarande läge.

**Styrka:** utåt-bias är rätt designval — beskärd text är värre än lite bakgrund.
**Svaghet:** ±5 px räcker bara för finjustering; en quad som ligger flera procent
innanför kanten kan inte räddas här, och snappen körs aldrig live.

---

## 4. Capture-logik

### 4.1 Räknare

| Räknare | Ökar | Minskar |
|---|---|---|
| `stableCount` | `+frameWeight` när `delta < STABLE_DELTA (0.035)` | `−frameWeight`; extra `−2·frameWeight` vid oskärpa eller mörker |
| `captureStableCount` | `+frameWeight` när `readyForCapture && isSharp && isBright && delta < STABLE_DELTA` | hårdnollas vid cooldown eller `!readyForCapture`; annars `−frameWeight` efter `CAPTURE_MISS_GRACE_FRAMES = 2` raka missar |
| `detectCount` | `+1`, tak `DETECT_COUNT_MAX = 6` | `−1` per miss |
| `missCount` | `+1` per miss | nollas vid träff; `≥ LOST_RESET_MISS_FRAMES (8)` ⇒ full quad-reset |

**Mål:** `readyTarget = verySteady ? 8 : 9`;
`stableTarget = gyro saknas ? 23 : (verySteady ? 13 : 15)`.
`verySteady` = gyro tillgängligt och `motionMag < 0.18`.

### 4.2 Grindkedja (alla måste hålla)

1. `readyForCapture` och **inte** `visibleOnly`
2. Ljus: `meanLum ≥ BRIGHTNESS_MIN (38)` (tolerant första 15 frames)
3. `captureStableCount ≥ HOLD_FRAMES (7)`
4. Skärpa: `sharpness ≥ SHARPNESS_LIVE_MIN (35)`
5. `captureStableCount ≥ READY_FRAMES (9)`
6. `captureStableCount ≥ stableTarget`
7. Alla hörn inom `CORNER_FRAME_INSET (0.02) … 0.98`
8. `now ≥ armedAtRef` (warm-up/rearm, 1200 ms)
9. Rörelse: `motionMag ≤ MOTION_STILL_THRESHOLD (0.45)`
10. `!ambiguous` (kandidatminne avstängt ⇒ blockerar aldrig idag)
11. `!visibleOnly` (omkontroll)

Misslyckas 7–9 kapas `captureStableCount` till `stableTarget − 1` i stället för att
nollas — användaren "står kvar precis före mållinjen".

### 4.3 Hi-res tightness

`computeHiResEdgeTightness` (`perspective.ts:3229-3320`) mäter om på full upplösning:
band 6 px, tolerans ±2 px, min gradient 22. Körs bara när `stableCount ≥ READY_FRAMES`,
throttlad 140 ms. Kan **uppgradera** `readyForCapture` false→true om 280/416-px-mätningen
underskattade tightness. `hiResTightConfirmedRef` styr sedan vilket golv som gäller i
`capture()` (`MIN_EDGE_TIGHTNESS_FOR_CAPTURE` vs `MIN_EDGE_TIGHTNESS_PRE_HIRES = 0.35`).

### 4.4 Capture-sekvensen (`scan.tsx:2037-2880`)

1. **Omkontroller:** confidence ≥ 0.12; tightness ≥ golv; A4-avvikelse ≤ `A4_RATIO_TOLERANCE (0.7)`; video redo.
2. **Burst:** 3 frames, frame 2–3 väntar på ny dekodad frame (`requestVideoFrameCallback`,
   fallback 50 ms, tak 80 ms). Varje bedöms med `canvasLaplacianVariance` på quadens bbox
   (320 px). Bäst blir `bestFrame` i full upplösning.
3. **Obiaserad omdetektering** på `bestFrame` — `detectDocumentQuad(..., {allowOverlay:false})`,
   **utan** `prefer`.
4. **Motion-discard:** avviker den nya quaden mer än `MOTION_DISCARD_FRACTION (0.02)` av
   kortsidan från live-quaden ⇒ `abortCaptureAndRearm("motion-discard")`.
   Ingen quad alls på bestFrame ⇒ `abortCaptureAndRearm("no-detection-on-bestframe")`.
   Kastar omdetekteringen ⇒ live-quaden behålls.
5. **Quadkedjan till warp:**
   `smoothQuad` → `srcQuad` (live) → `baseSrcQuad` (omdetekterad) →
   `refineQuadCorners` → `snapQuadToPaperEdges` → `orientQuadForA4Portrait` →
   inner-crop → `warpQuad`.
6. `abortCaptureAndRearm` (`2012-2034`): `captureStableCount = 0`, `stableCount −= 4`,
   lås av, 450 ms discard-cooldown, `armedAtRef = now + 1200 ms`, status `align`, loop startas om.

---

## 5. Warp

`warpQuadToRect` (`perspective.ts:97-220`): invers projektiv transform från enhetskvadrat,
**2×2 supersampling** (4 sub-samples per utpixel) med bilinjär interpolation; utanför
källan sätts vitt (255) så kanterna blir rena.

**Målupplösning är fast:** `TARGET_LONG = 2339`, `TARGET_SHORT = 1654` px
(A4 vid ~200 DPI), oberoende av quadens uppmätta proportion. Kommentaren i koden
motiverar det: sann dokumentproportion går inte att härleda från skärmpixlar utan
kameraintrinsics, så att gissa den skulle införa systematisk förkortning.

**Inner crop** (`2527-2531`): `0.005` om `refineQuadCorners` flyttade alla hörn ≤2 px,
annars `0.01`. Av med `?innercrop=0`, fast 1 % med `?adaptiveinnercrop=0`.

**autoStraighten** (`4494-4625`): skattar vinkeln via radprojektionsvarians på
mörkerplanet utan att rotera pixlarna. Anropas med `maxAngleDeg:5, stepDeg:0.25,
minApplyDeg:0.6, targetWidth:600, minConfidence:1.08`. Confidence = bästa/näst bästa
poäng utanför ±1 steg. Roterar aldrig 90/180° (det gör orienteringssteget före warp).

---

## 6. Efterbehandling och PDF

Ordning efter warp (`scan.tsx:2589-2832`), varje steg i try/catch som faller tillbaka
på oförändrad canvas:

1. **`cropToWhiteEdges`** — `stripPx:6, minMeanL:200, maxStdL:28`, tak 2 % per sida
   (adaptivt) eller 1 % (legacy). Adaptivt läge utvärderar varje sida separat och
   slutar så snart remsan antingen är papper eller *inte tydligt* bakgrund
   (marginaler 18 luma / 6 std). Beskär den, resamplas bilden tillbaka till 1654×2339.
2. **`autoStraighten`** — se ovan.
3. **`grayWorldWhiteBalance`** (`4048-4122`) — medelvärde över de 20 % ljusaste pixlarna,
   grönkanalen som neutralmål, gains klampade till 0.75–1.25, bara R och B skalas.
4. **`whitenBackground`** (`3560-3758`) — bakgrundsskattning via separabelt maxfilter
   (radie `max(4, longEdge·0.08)`) på ~320 px, blend 0→1 mellan luma 128 och 178
   (text skyddas under 128), extra avmättning av nästan vita pixlar, plus en slutpass
   som lyfter kvarvarande neutralgrå toner med detalj- och mättnadsskydd.
5. **`sharpenInk`** (`4200-4260`) — `amount:0.45, threshold:4, inkGate:150`.
   Enkelpass unsharp som bara verkar på bläckpixlar (L ≤ 150) med linjär ramp från 108,
   vilket undviker halo och brusförstärkning på papper.

**Kvalitetsgrindar efter behandling:**
`canvasLaplacianVariance < SHARPNESS_CAPTURE_MIN (110)` ⇒ omtag via
`abortCaptureAndRearm("post-capture-blurry")`, max `MAX_CAPTURE_RETRIES (2)`, aldrig vid
manuell capture. `canvasContrast < CONTRAST_CAPTURE_MIN (3)` ⇒ kastar, fångas och faller
tillbaka på `captureRawFrame()`.

**Lagring:** JPEG kvalitet 0.94 via `canvasToSafeImageDataUrl`, plus en 800 px/0.6
diagnostikkopia. `scanStore.addPage(dataUrl, { sourceDataUrl, detection })`.

**PDF:** byggs **inte** i skannern. `buildPdf()` i `src/lib/pdf.ts` anropas från
`send.tsx:226`: jsPDF A4 210×297 mm, `addImage(..., 0, 0, 210, 297)` med `"FAST"`
(JPEG-bytes bäddas in oförändrade). Signatur placeras 45×18 mm på angiven sida.

---

## 7. Statusmaskin

Statusunionen (`scan.tsx:51-66`) har 15 lägen. Övergångar:

```
starting ──getUserMedia ok──> searching ──detectCount≥3──> [hint-läge] ──alla grindar──> capturing ──> saved ──> searching
    │                              ▲                             │
    └── fel ──> error              └──── miss / lost-reset ◄──────┘
```

Hint-lägena väljs av en deterministisk if/else-kedja (`1756-1873`) i denna
prioritetsordning:

| Ordning | Status | Villkor |
|---|---|---|
| 1 | `lowLight` | `meanLum < 38` i >15 frames |
| 2 | `hold` | `captureStableCount < HOLD_FRAMES (7)` |
| 2b | `tooFar` / `tooClose` / `tilt` | `areaRatio < 0.18` (25 frames) resp. `< 0.12`; `> 0.88`; `a4Diff > 0.35` |
| 3 | `focusing` / `moveBack` | `!isSharp`, `moveBack` efter `BLUR_HINT_FRAMES (75)` |
| 4 | `hold` | `< READY_FRAMES (9)` |
| 5 | `ready` | `≥ READY_FRAMES` men `< stableTarget` |
| 6 | `align` | hörn utanför inset, eller `visibleOnly` kvar |
| 7 | `ready` | blockerad av cooldown / rörelse / ambiguity |
| 8 | `capturing` | alla grindar passerade |
| — | `uncertain` | confidence under min i `capture()` |
| — | `saved` | sida sparad, 700 ms overlay |
| — | `error` | osäker kontext, saknad API, nekad behörighet, getUserMedia-fel |

---

## 8. Temporalt state

| State | Skapas | Uppdateras | Nollställs | Stale-risk |
|---|---|---|---|---|
| `smoothQuad` | första träff | EMA varje accepterad frame | `startCamera`, lost-reset, efter sparning | Hög — driver både overlay, preferQuad och warp |
| `preferQuad` | härleds ur `smoothQuad` per frame | varje frame | när `biasDecayed` | Medel — förstärker sig själv |
| `lastRawQuad` | per frame | per frame | `startCamera`, lost-reset | Låg |
| `recentSmoothQuadsRef` | per frame | ringbuffer 7 | **endast `startCamera`** | Medel — överlever lock-break |
| `detectionMeta` | per träff | per träff | `startCamera`, lost-reset | Medel — läses i `capture()` |
| `lockedRef` / `lockBreakFramesRef` | vid lock | grind-/deltaberoende | många ställen | Låg |
| `outlierRejectFramesRef` | vid förkastad frame | outlier-grind | vid accepterad frame | Låg |
| `candidateHistoryRef` / `ambiguousFramesRef` | — | — | — | Inert (flagga av) |
| `stableCount` / `captureStableCount` / `captureMissStreakRef` | per frame | tidsviktat | cooldown, miss, capture, reset | Låg |
| `detectCount` / `missCount` | per frame | ±1 | lost-reset | Låg |
| `motionMagRef` / `motionSamplesRef` / `motionAvailableRef` | devicemotion | EMA 0.7/0.3 | `startCamera` | Låg |
| `hiResTightConfirmedRef` | vid hi-res-mätning | throttlad 140 ms | `startCamera`, lock-break | **Hög** — sätts sant så fort en mätning returnerar värde, oavsett resultat |
| `armedAtRef` / `captureCooldownUntilRef` | kamerastart / capture | tidsstämplar | avsiktligt kvar efter sparning | Låg |

Refs som **inte** ingår i huvudresetblocket: `detectWorkerFailedRef`, `detectReqIdRef`,
`outlierRejectFramesRef`, `stageTimerRef`/`savedTimer*Ref`, `trackCapsRef`, `cameraStartTokenRef`.

---

## 9. Worker

`detect.worker.ts` är avsiktligt tunn: tar emot `{id, width, height, pixels, prefer,
allowOverlay}`, kör `detectDocumentQuad` och svarar `{id, ok, detection, diagnostics}`.

- **Skapas** lazily, `type:"module"`, en gång per session.
- **Överföring:** structured clone, **inte** transfer — huvudtråden behåller sin
  pixelbuffert för skärpe- och luminansmätning efter anropet (~390 KB/frame vid 416 px).
- **Matchning:** monoton `detectReqIdRef`, `Map<id, resolver>`; svar raderar sin post.
- **Timeout:** `DETECT_WORKER_TIMEOUT_MS = 1500`, resolvar `null` (avvisar aldrig).
- **In-flight-skydd:** `detectInFlightRef` — överlappande pass hoppas över, köas inte.
- **Fallback:** worker av/otillgänglig/failad/timeout/undantag ⇒ synkron
  `detectDocumentQuad` på huvudtråden. Diagnostik speglas via `setLastDetectDiagnostics`.
- **onerror:** markerar workern som permanent trasig, dränerar pending, terminerar.

**Synk mot video:** ingen frame-identitet skickas med. När promiset resolvar har
`<video>` hunnit vidare. Ställen där ett worker-resultat medvetet möter en nyare frame:
preferQuad-biasen, outlier-jämförelsen mot `smoothQuad`, och warpen som använder
overlay-quaden. Just glappet vid capture hanteras separat av burst + obiaserad
omdetektering + motion-discard (avsnitt 4.4).

---

## 10. Feature flags

### Kompileringsflaggor

| Flagga | Värde | Används | Bedömning |
|---|---|---|---|
| `ENABLE_DYNAMIC_STABLE_TARGET` | true | ja (`1655`) | aktiv |
| `ENABLE_SOFT_STABLE_DECAY` | true | ja (`1634`) | aktiv; off-gren kvar |
| `ENABLE_DETECT_WORKER` | true | ja | aktiv; fallback krävs |
| `ENABLE_TIME_BASED_STABILITY` | true | ja | aktiv |
| `ENABLE_HI_RES_DETECT` | false | nej (`void`) | **död — kan tas bort** |
| `ENABLE_PREFER_BIAS_GATE` | false | grind alltid sann | avsiktligt permanent på; kan förenklas bort |
| `ENABLE_LIVE_CORNER_REFINE` | false | grind (`1241`) | legacy — kod kvar men aldrig aktiv |
| `ENABLE_HIRES_TIGHTNESS_RECOMPUTE` | true | ja (`1274`) | aktiv |
| `ENABLE_DETECT_HIRES` | true | ja (`334`) | aktiv |
| `ENABLE_CANDIDATE_MEMORY` | false | grind (`1474`, `1789`) | legacy — ambiguity-logiken är inert |
| `ENABLE_GENEROUS_OVERLAY` | true | ja | aktiv |
| `ENABLE_WHITENESS_CHANNEL` | true | ja | aktiv |
| `ENABLE_ADAPTIVE_EDGE_TIGHTNESS` | true | ja | aktiv |
| `ENABLE_MIN_SIDE_SUPPORT` | true | ja | aktiv |
| `ENABLE_INSIDE_PAPER_PENALTY` | true | ja | aktiv |
| `ENABLE_HOUGH_LINE_DETECTION` | false | grind | **död kod-väg — stor, kan tas bort** |
| `ENABLE_PAPER_INTERIOR_PRIOR` | false | `void paperInteriorScore` | **död — kan tas bort** |

### URL-parametrar

`?worker=0`, `?timestable=0`, `?debug=1`, `?innercrop=0`, `?adaptiveinnercrop=0`,
`?whitecrop=0`, `?adaptivecrop=0`, `?straighten=0`, `?noWhiten=1`, `?noInkBoost=1`,
`?rawWarpOnly=1`, `?refineCorners=0`, `?noSnapQuad=1`, `?voting=1`, `?paperLock=1`.

Sammanlagt 17 kompileringsflaggor + 15 URL-flaggor ⇒ teoretiskt mycket stor
konfigurationsrymd; endast en kombination testas i praktiken.

---

## 11. Viktigaste konstanterna

| Konstant | Värde | Roll |
|---|---|---|
| `DETECT_WIDTH` | 416 | detekteringsupplösning |
| `DETECT_INTERVAL_MS` | 45 | ~22 Hz |
| `DETECT_WORKER_TIMEOUT_MS` | 1500 | worker-timeout |
| `NOMINAL_FRAME_MS` | 40 | referens för `frameWeight` |
| `STABLE_DELTA` | 0.035 | jittergräns |
| `DETECT_FRAMES` / `HOLD_FRAMES` | 3 / 7 | overlay resp. "håll stilla" |
| `READY_FRAMES` / `READY_FRAMES_STEADY` | 9 / 8 | lock-in |
| `STABLE_FRAMES` / `_STEADY` / utan gyro | 15 / 13 / 23 | capture-mål |
| `CAPTURE_MISS_GRACE_FRAMES` | 2 | soft decay |
| `DETECT_COUNT_MAX` / `LOST_RESET_MISS_FRAMES` | 6 / 8 | lost-reset |
| `ALPHA_PRE_LOCK` / `ALPHA_POST_LOCK` | 0.18 / 0.07 | EMA |
| `OUTLIER_DELTA` / `LOCK_BREAK_DELTA` | 0.13 / 0.20 | outlier / lock-break |
| `EXPANSION_MIN_CONFIDENCE` / `_AREA_GAIN` | 0.45 / 1.02 | expansionsundantag |
| `OUTLIER_BIAS_DECAY_FRAMES` | 6 | bias-förfall |
| `MOTION_STILL_THRESHOLD` / `_VERY_STILL` | 0.45 / 0.18 m/s² | rörelsegrindar |
| `MOTION_DISCARD_FRACTION` | 0.02 | capture-synk |
| `CORNER_FRAME_INSET` | 0.02 | hörnmarginal |
| `A4_RATIO_TOLERANCE` | 0.7 | proportionsgrind |
| `MIN_DOCUMENT_CONFIDENCE` | 0.12 | acceptansgolv |
| `MIN_EDGE_TIGHTNESS_PRE_HIRES` | 0.35 | tightness före hi-res |
| min per-sida-tightness | 0.25 | `weakSideSupport` |
| `SHARPNESS_LIVE_MIN` / `_CAPTURE_MIN` | 35 / 110 | skärpa |
| `CONTRAST_CAPTURE_MIN` | 3 | blank-skydd |
| `BRIGHTNESS_MIN` | 38 | mörkergrind |
| `REARM_DELAY_MS` / `CAMERA_WARMUP_MS` | 1200 | arming |
| `MAX_CAPTURE_RETRIES` | 2 | omtag vid oskärpa |
| `INNER_CROP_FRACTION` | 0.005 / 0.01 | krympning före warp |
| white-crop-tak | 0.02 per sida | efterbeskärning |
| `TARGET_LONG` / `TARGET_SHORT` | 2339 / 1654 | A4 @ ~200 DPI |
| JPEG-kvalitet | 0.94 | lagring |

---

## 12. Riskanalys — var komplexiteten sitter

1. **Den monolitiska `detect()`-funktionen** (~770 rader) blandar mätning, scoring,
   temporal filtrering, statusval, overlay-ritning, capture-beslut och loggning i en
   enda if/else-kedja. Varje ändring har bred blast radius.
2. **Två parallella scoringsystem** (`confidence` och `outerConfidence`) med olika
   formler för samma begrepp (`areaScore`, `a4Score`). Kalibrering på ett ställe
   påverkar rangordningen på ett icke-uppenbart sätt.
3. **Tidsviktade räknare mot frame-uttryckta trösklar.** Konstanterna heter `_FRAMES`
   men mäter numera tid. Läsbarheten haltar och tröskelmatematiken blir enhetslös.
4. **Asynkron detektering utan frame-identitet.** Kontrakt mellan worker-resultat och
   videotillstånd är implicit; korrektheten upprätthålls av kompenserande mekanismer
   (motion-discard, burst) snarare än av datastrukturen.
5. **Refs som delad muterbar värld.** ~45 refs, minst tre olika resetplatser med olika
   täckning. Att avgöra vilket tillstånd som gäller vid en given frame kräver att man
   läser hela filen.
6. **Trösklar utan gemensam härkomst.** ~40 magiska tal, många inbördes beroende
   (t.ex. `OUTLIER_DELTA` vs `MOTION_DISCARD_FRACTION`, `INNER_CROP` vs white-crop-tak).
   Det finns inget ställe som beskriver vilka som måste ändras tillsammans.
7. **Efterbehandlingskedjan är destruktiv och sekventiell.** Fem steg som var för sig
   är rimliga men som tillsammans kan förstärka varandras artefakter; bara sista
   resultatet mäts (skärpa/kontrast), aldrig mellanstegen.
8. **Flaggexplosionen.** 32 växlar ⇒ ingen realistisk testtäckning; flera off-grenar är
   kod som aldrig körs men fortfarande måste underhållas och läsas.
9. **Fixed-A4-antagandet** är korrekt motiverat men osynligt för resten av kedjan —
   allt nedströms (crop, straighten, PDF) förlitar sig tyst på det.
10. **Diagnostik via modulglobal** (`setLastDetectDiagnostics`) som speglas manuellt från
    workern — fungerar, men är ett sidokanalskontrakt utanför typsystemet.

---

## 13. Tio största arkitektoniska förbättringarna (rangordnade)

1. **Bryt ut detekteringstillståndet till en ren tillståndsmaskin.**
   En `reducer(state, observation) -> state` utan DOM-, canvas- eller React-beroenden.
   Störst effekt på både stabilitet och underhållbarhet; gör hela grindkedjan
   enhetstestbar mot inspelade observationssekvenser.
2. **Stämpla varje detektering med frame-identitet och tidsstämpel.**
   Gör worker-latensen explicit i datamodellen i stället för kompenserad i efterhand.
   Löser hela klassen "gammal quad möter ny frame" på ett ställe.
3. **Ett enda scoringsystem.** Slå ihop `confidence` och `outerConfidence` till en
   formel med en uppsättning normaliserade termer. Direkt vinst i detektionskvalitet
   eftersom rangordningen blir förutsägbar och kalibrerbar.
4. **Central tröskelmodul.** Alla ~40 konstanter i en fil, grupperade, med enheter i
   namnen (`STABLE_MS` i stället för `STABLE_FRAMES`) och dokumenterade beroenden.
5. **Guldsvit med inspelade sessioner.** Spara råframes + förväntad quad för ~30 fall
   (golv, trä, skugga, sned vinkel, låg kontrast) och kör hela pipelinen i test.
   Utan detta är varje tröskeländring en gissning.
6. **Rensa döda vägar.** `ENABLE_HOUGH_LINE_DETECTION`, `ENABLE_PAPER_INTERIOR_PRIOR`,
   `ENABLE_HI_RES_DETECT`, `ENABLE_LIVE_CORNER_REFINE`, `ENABLE_CANDIDATE_MEMORY`,
   `ENABLE_PREFER_BIAS_GATE` samt `unsharpMaskText`/`boostInkContrast`.
   Sannolikt >600 rader inaktiv kod.
7. **Enhetlig reset.** En `resetDetectionState()` som är den *enda* platsen som nollar
   temporalt state, anropad från alla tre nuvarande ställena. Tar bort hela klassen
   "ref som glömdes i ett av resetblocken".
8. **Transferable buffers + återanvänd pixelbuffert till workern.** ~390 KB structured
   clone per frame vid 22 Hz är den enskilt största kvarvarande huvudtrådskostnaden;
   dubbelbuffring löser det utan att förlora mätningen på huvudtråden.
9. **Gör efterbehandlingen mätbar.** Beräkna skärpa/kontrast före och efter varje steg
   i debugläge, så att bildkvalitetsregressioner kan härledas till rätt steg i stället
   för till slutresultatet.
10. **Separera "vad kameran ser" från "vad vi ritar".** Overlay-quaden är i dag samma
    objekt som warp-quaden. En explicit uppdelning i `displayQuad` och `captureQuad`
    gör WYSIWYG till ett medvetet val per steg i stället för en implicit koppling.
