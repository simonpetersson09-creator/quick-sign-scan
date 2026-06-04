import { jsPDF } from "jspdf";

function detectImageFormat(dataUrl: string): "PNG" | "JPEG" {
  // dataURL format: "data:image/<type>;base64,..."
  const m = /^data:image\/(png|jpe?g)/i.exec(dataUrl);
  if (!m) return "JPEG"; // sensible default for camera output
  return m[1].toLowerCase() === "png" ? "PNG" : "JPEG";
}

// Build an A4 PDF from one or more image dataURLs, optionally with a
// signature overlay rendered on the last page.
export async function buildPdf(
  images: string | string[],
  signature?: { dataUrl: string; x: number; y: number } | null,
): Promise<string> {
  const pages = Array.isArray(images) ? images.filter(Boolean) : [images];
  if (pages.length === 0) {
    throw new Error("buildPdf: at least one image is required");
  }
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;

  pages.forEach((imageDataUrl, idx) => {
    if (idx > 0) pdf.addPage("a4", "portrait");
    const imgFormat = detectImageFormat(imageDataUrl);
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, pageW, pageH, "F");
    // eslint-disable-next-line no-console
    console.log("[scan:pdf-generation]", {
      pageIndex: idx,
      pageWidthMm: pageW,
      pageHeightMm: pageH,
      imageFormat: imgFormat,
      dataUrlBytes: imageDataUrl.length,
    });
    // PNG keeps exact edge pixels; JPEG pages use SLOW as best-quality DCT.
    const compression = imgFormat === "JPEG" ? "SLOW" : undefined;
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

  return pdf.output("datauristring");
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(header)?.[1] ?? "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
