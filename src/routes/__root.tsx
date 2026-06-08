import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { LanguageProvider } from "@/lib/i18n";
import { AccessCodeGate } from "@/components/AccessCodeGate";
import { KeyboardToolbar } from "@/components/KeyboardToolbar";
import { scanStore } from "@/lib/scanStore";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  // Stale chunk after a redeploy: the lazy-loaded route bundle hash has
  // changed and the old hashed file no longer exists. The browser then
  // throws "Importing a module script failed" / "Failed to fetch dynamically
  // imported module". The only safe recovery is a hard reload so the new
  // index.html with current chunk hashes is loaded.
  const msg = (error?.message || "").toLowerCase();
  const isChunkError =
    msg.includes("importing a module script failed") ||
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("dynamically imported module") ||
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk");

  // Don't auto-reload if an in-memory scan session is in progress — a hard
  // reload wipes scanStore (privacy-by-design: nothing is persisted) and the
  // user loses the pages they just captured. In that case we instead let the
  // user retry the failed route load via the "Try again" button, which calls
  // router.invalidate() and re-imports the chunk without nuking app state.
  const hasInflightSession =
    typeof window !== "undefined" && scanStore.getPages().length > 0;

  if (typeof window !== "undefined" && isChunkError && !hasInflightSession) {
    // Avoid an infinite reload loop — only auto-reload once per session.
    const KEY = "__lov_chunk_reloaded";
    if (!sessionStorage.getItem(KEY)) {
      sessionStorage.setItem(KEY, "1");
      window.location.reload();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              if (isChunkError && typeof window !== "undefined") {
                const hasInflightSession = scanStore.getPages().length > 0;
                if (!hasInflightSession) {
                  window.location.reload();
                  return;
                }
                router.invalidate();
                reset();
                return;
              }
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}


export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "SSPP Sign & Go" },
      { name: "description", content: "." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "SSPP Sign & Go" },
      { property: "og:description", content: "." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "SSPP Sign & Go" },
      { name: "twitter:description", content: "." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/71807420-192d-43db-9d16-8d469fe22ccd/id-preview-42d562a8--69a35b64-3eb9-4e68-8e67-6b39a3a3ec0e.lovable.app-1780670043466.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/71807420-192d-43db-9d16-8d469fe22ccd/id-preview-42d562a8--69a35b64-3eb9-4e68-8e67-6b39a3a3ec0e.lovable.app-1780670043466.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AccessCodeGate>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </AccessCodeGate>
        <Toaster />
        <KeyboardToolbar />
      </LanguageProvider>
    </QueryClientProvider>
  );
}
