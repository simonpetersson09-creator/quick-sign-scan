# A4-detektor golden-set

Sprint 1-rigg för att mäta detekteringskvalitet objektivt.

## Köra

```bash
bun run tests/golden/harness.ts
```

## Lägg till en fixture

1. Spara bilden som `tests/golden/fixtures/<namn>.png` (helst i samma upplösning som mobilkameran tar, t.ex. 1920×1440).
2. Skapa `tests/golden/fixtures/<namn>.json` med facit-hörn (i pixelkoordinater på originalbilden, ordning: top-left, top-right, bottom-right, bottom-left):

```json
{ "corners": [[120, 80], [1810, 95], [1795, 1380], [110, 1365]] }
```

## Tröskel

`MIN_IOU = 0.85` — räknas som PASS om detekterad quad överlappar facit ≥ 85 %.

## Rekommenderad initial uppsättning (60 fixtures)

| Kategori | Antal | Notering |
|----------|-------|----------|
| Mörkt bord, jämn belysning | 8 | Baseline |
| Vitt bord, jämn belysning | 6 | "Vitt-på-vitt" |
| Sidobelysning / hård skugga | 8 | En kant försvinner |
| Snedfotograferat (perspektiv) | 8 | Trapets, upp till 30° lutning |
| Litet/avlägset A4 (<30% av frame) | 8 | Stressar upplösning |
| Stort/när (>80% av frame) | 4 | Skär nästan kanten |
| Konkurrerande objekt (laptop, bok, telefon i frame) | 8 | A4-gate-test |
| Liggande A4 i porträtt-kamera | 4 | Orientering |
| Skrynklat/mjuk skugga på papper | 4 | Kantbrott |
| Färgat/textat papper (kvitto, blankett) | 2 | Interior-prior |

## Baseline (uppdateras varje sprint)

| Sprint | Pass / Total | Snitt IoU | Notering |
|--------|-------------|-----------|----------|
| 1 | — | — | Hård A4-gate (0.35), DETECT_WIDTH 360→416 |
