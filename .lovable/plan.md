# Åtgärdsplan: orientering, ren warp och vitgörning

Detekteringen lämnas orörd. Vi fokuserar på de tre felen som syns efter att hörnen är hittade.

---

## Steg 1 — En enda orienteringsbeslut, före warp

Idag bestäms orientering på flera ställen (warp, auto-orient, force-portrait). De konkurrerar och resultatet blir liggande även när pappret är stående.

Ny modell — **ett** beslut, sedan inga fler rotationer:

1. När quad finns: gör en liten thumbnail-warp (~200 px bred) med quadens egen aspect ratio.
2. Mät text-orientering via horisontell/vertikal projektion (rader = upprätt text).
3. Välj 0/90/180/270 **en gång** och rotera hörnens ordning (TL/TR/BR/BL) innan riktig warp.
4. Riktig `warpQuadToRect` körs med korrekt hörnordning + quadens egen aspect ratio → output blir alltid stående A4, utan extra omsampling.
5. **Ta bort** `autoOrientAndDeskewDocument`-anropet helt.
6. **Ta bort** hårdkodade `outW=1654/outH=2339` — använd quadens aspect ratio.

Loggning: `quadIn`, `chosenRotation`, `quadAfterRotate`, `outW/outH`.

**Checkpoint:** stående papper → stående output. Liggande papper → stående output (roterat). Ingen dubbelrotation, ingen suddighet.

---

## Steg 2 — Ren warp utan bakgrund eller vita kanter

- `EDGE_MARGIN = 0` i `src/routes/scan.tsx`.
- Ta bort all "fill background"-logik i warpen — output-canvas = exakt warpens storlek.
- Ingen padding, ingen vit ram, ingen sampling utanför quad.

**Checkpoint:** vitt papper → resultatet visar bara papper, ingen träkant, ingen vit kant.

---

## Steg 3 — Textsäker vitgörning (löser grå fläckar + veck)

Ny `whitenBackground` i `src/lib/perspective.ts`. Ersätter `enhancePaper`, `removeShadows`, `cleanPaperEdges`, ev. "ink-boost".

Algoritm (flat-field correction, samma teknik som Lens/CamScanner):
1. Stor box-blur (~5% av bildbredd) → uppskattar lokal bakgrundsnivå (ljus + skuggor + veck).
2. Dividera bilden med bakgrunden → pappret blir jämnvitt.
3. **Skydda mörka pixlar**: pixlar under tröskel rörs inte → text förblir svart och skarp.
4. Mild gammakurva (~0.95). **Ingen** binarisering. **Ingen** unsharp mask.

Tillagd som standardfilter i `src/routes/preview.tsx` ("Smart vit").

**Checkpoint:**
- Veck och skuggor borta.
- Inga grå fläckar.
- Diff mot original: ingen text försvunnen, även smått i sidfot.

---

## Felsökningsflaggor (under arbetet)

`?step=1` stoppar efter orientering, `?step=2` efter ren warp, `?step=3` full pipeline. Då kan vi isolera vilket steg som bryts om något ser fel ut.

---

## Filer som påverkas

- `src/lib/perspective.ts` — ny orienteringslogik, ny `whitenBackground`, tar bort gamla filter och `autoOrientAndDeskewDocument`-anropet.
- `src/routes/scan.tsx` — `EDGE_MARGIN=0`, tar bort hårdkodade A4-dimensioner, lägger till `?step=` flagga, anropar `whitenBackground` efter warp.
- `src/routes/preview.tsx` — "Smart vit" som standardfilter.

---

## Vad vi INTE gör

- Rör inte detekteringen.
- Ingen ML, ingen extern dependency, ingen OCR.
- Ingen efter-deskew (extra rotation = suddig text).
- Inte flera filter samtidigt — ett i taget, med checkpoint emellan.

---

## Ordning

Ett steg i taget med verifiering emellan. Säg till om jag ska köra Steg 1 först, eller hela paketet på en gång.
