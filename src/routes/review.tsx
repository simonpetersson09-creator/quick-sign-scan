import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { buildPdf } from "@/lib/pdf";
import { ArrowLeft, Send } from "lucide-react";

export const Route = createFileRoute("/review")({
  head: () => ({ meta: [{ title: "Granska" }] }),
  component: ReviewPage,
});

function ReviewPage() {
  const navigate = useNavigate();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    const s = scanStore.get();
    const img = s.imageDataUrl;
    if (!img) {
      navigate({ to: "/" });
      return;
    }
    (async () => {
      const sig =
        s.signatureDataUrl && s.signaturePosition
          ? { dataUrl: s.signatureDataUrl, x: s.signaturePosition.x, y: s.signaturePosition.y }
          : null;
      const url = await buildPdf(img, sig);
      setPdfUrl(url);
      scanStore.set({ pdfDataUrl: url });
    })();
  }, [navigate]);

  return (
    <AppShell title="Granska dokument" back="/sign">
      <p className="text-sm text-muted-foreground mt-1 mb-3">
        Så här kommer dokumentet att skickas.
      </p>
      <div className="flex-1 flex items-center justify-center">
        <div
          className="rounded-2xl overflow-hidden shadow-[var(--shadow-card)] border border-border bg-white"
          style={{ width: "min(82vw, 360px)", aspectRatio: "1 / 1.414" }}
        >
          {pdfUrl ? (
            <iframe
              src={pdfUrl}
              title="PDF-förhandsvisning"
              className="w-full h-full"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
              Skapar PDF…
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-5">
        <PrimaryButton onClick={() => navigate({ to: "/send" })} disabled={!pdfUrl}>
          <span className="inline-flex items-center justify-center gap-2">
            <Send className="h-5 w-5" /> Fortsätt till sändning
          </span>
        </PrimaryButton>
        <PrimaryButton variant="ghost" onClick={() => navigate({ to: "/sign" })}>
          <span className="inline-flex items-center justify-center gap-2">
            <ArrowLeft className="h-5 w-5" /> Ändra signatur
          </span>
        </PrimaryButton>
      </div>
    </AppShell>
  );
}
