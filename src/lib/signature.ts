// Gemensam storleksregel för signaturen så att förhandsvisningen i /review
// och den slutliga PDF:en alltid matchar varandra.
//
// Signaturen skalas efter sitt eget bildförhållande och begränsas av BÅDE en
// maxbredd och en maxhöjd uttryckt som andel av A4-sidan. Tidigare tvingades
// signaturen in i en fast 45 × 18 mm-ruta, vilket både förvrängde bilden och
// gjorde breda signaturer onödigt stora i förhållande till sidan.

/** Max bredd som andel av sidbredden (0.22 × 210 mm ≈ 46 mm). */
export const SIG_MAX_W_FRAC = 0.22;
/** Max höjd som andel av sidhöjden (0.055 × 297 mm ≈ 16 mm). */
export const SIG_MAX_H_FRAC = 0.055;

/**
 * Räknar ut signaturens storlek som andel av sidan, med bevarat
 * bildförhållande (bredd/höjd på den trimmade signaturbilden).
 */
export function signatureBoxFractions(aspect: number | null | undefined): {
  w: number;
  h: number;
} {
  // Rimlig fallback innan bilden hunnit laddas: typisk signatur ~3:1.
  const a = aspect && isFinite(aspect) && aspect > 0 ? aspect : 3;
  // Utgå från maxbredden och se om höjden ryms.
  let w = SIG_MAX_W_FRAC;
  // Höjd i sidhöjds-andel: (w · pageW) / aspect / pageH, A4 → pageW/pageH = 210/297
  const pageRatio = 210 / 297;
  let h = (w * pageRatio) / a;
  if (h > SIG_MAX_H_FRAC) {
    h = SIG_MAX_H_FRAC;
    w = (h * a) / pageRatio;
  }
  return { w, h };
}

/** Samma beräkning men i millimeter på A4. */
export function signatureBoxMm(aspect: number | null | undefined): {
  w: number;
  h: number;
} {
  const f = signatureBoxFractions(aspect);
  return { w: f.w * 210, h: f.h * 297 };
}

/** Läser in en dataURL och returnerar bredd/höjd-förhållandet. */
export function imageAspect(dataUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () =>
      resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
