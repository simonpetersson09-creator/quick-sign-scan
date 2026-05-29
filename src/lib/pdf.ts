import { jsPDF } from "jspdf";

// Build an A4 PDF from an image dataURL, optionally with a signature overlay.
export async function buildPdf(
  imageDataUrl: string,
  signature?: { dataUrl: string; x: number; y: number } | null,
): Promise<string> {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;

  // Add the document image, fit to full A4
  pdf.addImage(imageDataUrl, "JPEG", 0, 0, pageW, pageH, undefined, "FAST");

  if (signature && signature.dataUrl) {
    const sigW = 60; // mm
    const sigH = 25;
    const cx = signature.x * pageW;
    const cy = signature.y * pageH;
    pdf.addImage(
      signature.dataUrl,
      "PNG",
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
