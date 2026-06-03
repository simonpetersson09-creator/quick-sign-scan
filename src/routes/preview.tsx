import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { useT } from "@/lib/i18n";
import { RefreshCw, ArrowRight, Plus, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/preview")({
  head: () => ({ meta: [{ title: "Förhandsgranska" }] }),
  component: PreviewPage,
});

function PreviewPage() {
  const navigate = useNavigate();
  const t = useT();
  const [image, setImage] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);

  useEffect(() => {
    const img = scanStore.get().imageDataUrl;
    if (!img) {
      navigate({ to: "/" });
      return;
    }
    const session = scanStore.get();
    setImage(img);
    setPages(session.pages);
  }, [navigate]);

  function retake() {
    scanStore.set({
      imageDataUrl: null,
      sourceDataUrl: null,
      pages: [],
      detection: null,
      signatureDataUrl: null,
      signaturePosition: null,
      pdfDataUrl: null,
    });
    navigate({ to: "/scan" });
  }

  function addPage() {
    navigate({ to: "/scan" });
  }

  function accept() {
    navigate({ to: "/place" });
  }

  if (!image) return null;

  return (
    <AppShell title={t("previewTitle")} back="/">
      <p className="text-sm text-muted-foreground mt-1 mb-3">
        {t("previewHint")}
      </p>

      <div className="flex items-center justify-center">
        <div
          className="rounded-2xl overflow-hidden shadow-[var(--shadow-card)] border border-border bg-white"
          style={{ width: "min(78vw, 340px)", aspectRatio: "1 / 1.414" }}
        >
          <img
            src={image}
            alt={t("scannedAlt")}
            className="w-full h-full object-contain bg-white"
          />
        </div>
      </div>

      {pages.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {pages.map((p, i) => (
            <div
              key={i}
              className={`shrink-0 rounded-md overflow-hidden border-2 ${
                p === image ? "border-primary" : "border-border"
              } bg-white`}
              style={{ width: 56, aspectRatio: "1 / 1.414" }}
            >
              <img src={p} alt="" className="w-full h-full object-contain" />
            </div>
          ))}
        </div>
      )}

      <div className="flex-1" />

      <div className="flex flex-col gap-3 pt-5">
        <PrimaryButton onClick={accept}>
          <span className="inline-flex items-center justify-center gap-2">
            {t("useDocument")} <ArrowRight className="h-5 w-5" />
          </span>
        </PrimaryButton>
        <div className="grid grid-cols-2 gap-3">
          <PrimaryButton variant="secondary" onClick={addPage}>
            <span className="inline-flex items-center justify-center gap-2">
              <Plus className="h-5 w-5" /> {t("addPage")}
            </span>
          </PrimaryButton>
          <PrimaryButton variant="secondary" onClick={retake}>
            <span className="inline-flex items-center justify-center gap-2">
              <RefreshCw className="h-5 w-5" /> {t("retake")}
            </span>
          </PrimaryButton>
        </div>
      </div>
    </AppShell>
  );
}
