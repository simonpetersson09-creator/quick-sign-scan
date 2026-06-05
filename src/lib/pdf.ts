import { jsPDF } from "jspdf";

function detectImageFormat(dataUrl: string): "PNG" | "JPEG" {
  // dataURL format: "data:image/<type>;base64,..."
  const m = /^data:image\/(png|jpe?g)/i.exec(dataUrl);
  if (!m) return "JPEG"; // sensible default for camera output
  return m[1].toLowerCase() === "png" ? "PNG" : "JPEG";
}

function approxBytes(dataUrl: string): number {
  // base64 → ~0.75 bytes per char
  const b64 = dataUrl.split(",")[1] ?? "";
  return Math.round(b64.length * 0.75);
}

// Build an A4 PDF from one or more image dataURLs, optionally with a
// signature overlay rendered on the last page.
//
// PDF size strategy:
//   - Sidor förväntas redan vara JPEG @ ~200 DPI (≈1654 px breda) från
//     scan-flödet. jsPDF bäddar in JPEG-bytesen oförändrat utan att
//     re-encoda, så filstorleken styrs i praktiken av käll-JPEG:en.
//   - Inga metadata (title/author/subject) sätts → minskar overhead.
//   - Vit bakgrund ritas EJ längre eftersom hela sidan ändå täcks av bilden.
export async function buildPdf(
  images: string | string[],
  signature?: { dataUrl: string; x: number; y: number } | null,
): Promise<string> {
  const pages = Array.isArray(images) ? images.filter(Boolean) : [images];
  if (pages.length === 0) {
    throw new Error("buildPdf: at least one image is required");
  }
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  const pageW = 210;
  const pageH = 297;

  let totalInputBytes = 0;
  pages.forEach((imageDataUrl, idx) => {
    if (idx > 0) pdf.addPage("a4", "portrait");
    const imgFormat = detectImageFormat(imageDataUrl);
    const bytes = approxBytes(imageDataUrl);
    totalInputBytes += bytes;
    // eslint-disable-next-line no-console
    console.log("[scan:pdf-page]", {
      pageIndex: idx,
      pageWidthMm: pageW,
      pageHeightMm: pageH,
      imageFormat: imgFormat,
      imageKB: Math.round(bytes / 1024),
      warning:
        imgFormat === "PNG"
          ? "PNG-sidor är 5-10x större än JPEG — kontrollera scan-pipeline"
          : undefined,
    });
    // JPEG embeds bytes verbatim (FAST = no extra zlib pass).
    const compression = imgFormat === "JPEG" ? "FAST" : "MEDIUM";
    pdf.addImage(imageDataUrl, imgFormat, 0, 0, pageW, pageH, undefined, compression);
  });

  if (signature && signature.dataUrl) {
    // Signature is placed on the last page.
    const sigW = 60; // mm
    const sigH = 25;
    const cx = signature.x * pageW;
    const cy = signature.y * pageH;
    const sigFormat = detectImageFormat(signature.dataUrl);
    pdf.addImage(
      signature.dataUrl,
      sigFormat,
      Math.max(0, cx - sigW / 2),
      Math.max(0, cy - sigH / 2),
      sigW,
      sigH,
    );
  }

  const out = pdf.output("datauristring");
  const outBytes = approxBytes(out);
  // eslint-disable-next-line no-console
  console.log("[scan:pdf-generation]", {
    pageCount: pages.length,
    inputImagesKB: Math.round(totalInputBytes / 1024),
    finalPdfKB: Math.round(outBytes / 1024),
    finalPdfMB: +(outBytes / 1024 / 1024).toFixed(2),
    avgPageKB: Math.round(outBytes / 1024 / pages.length),
  });
  return out;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(header)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
