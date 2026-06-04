// Convert a PDF File into an array of PNG data URLs (one per page).
// Dynamically imported so pdfjs-dist (which references browser-only globals
// like DOMMatrix) never runs during SSR.

export async function pdfFileToImages(file: File, scale = 2): Promise<string[]> {
  if (typeof window === "undefined") {
    throw new Error("pdfFileToImages can only run in the browser");
  }
  const pdfjsLib = await import("pdfjs-dist");
  // @ts-ignore - worker as URL
  const pdfWorker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    pages.push(canvas.toDataURL("image/png"));
  }
  return pages;
}
