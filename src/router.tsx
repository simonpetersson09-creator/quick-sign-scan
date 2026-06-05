import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { installCapacitorFetch } from "./lib/capacitor-fetch";
import { installAccessCodeFetch } from "./lib/access-fetch";

// Order matters: install URL rewriting first (Capacitor only), then the
// header attacher on top. Both are no-ops outside their intended environment.
installCapacitorFetch();
installAccessCodeFetch();

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
