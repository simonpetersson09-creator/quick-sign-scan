// Attaches the shared access code as `x-app-access` to every serverFn RPC.
// Runs as a TanStack Start client function middleware so the header is
// applied whether or not the global `fetch` wrapper installed first. This
// matches how Supabase auth attaches its bearer token.

import { createMiddleware } from "@tanstack/react-start";
import { getAccessCode } from "./access-code";

export const attachAccessCode = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const code = getAccessCode();
    return next({
      headers: code ? { "x-app-access": code } : {},
    });
  },
);
