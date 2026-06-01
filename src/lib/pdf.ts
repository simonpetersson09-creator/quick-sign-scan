import { jsPDF } from "jspdf";

function detectImageFormat(dataUrl: string): "PNG" | "JPEG" {
  // dataURL format: "data:image/<type>;base64,..."
  const m = /^data:image\/(png|jpe?g)/i.exec(dataUrl);
  if (!m) return "JPEG"; // sensible default for camera output
  return m[1].toLowerCase() === "png" ? "PNG" : "JPEG";
}

// Build an A4 PDF from an image dataURL, optionally with a signature overlay.
export async function buildPdf(
  imageDataUrl: string,
  signature?: { dataUrl: string; x: number; y: number } | null,
): Promise<string> {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;

  // Add the document image, fit to full A4. Format must match the dataURL,
  // otherwise jsPDF may emit warnings or produce a corrupt image.
  const imgFormat = detectImageFormat(imageDataUrl);
  pdf.addImage(imageDataUrl, imgFormat, 0, 0, pageW, pageH, undefined, "FAST");

  if (signature && signature.dataUrl) {
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
