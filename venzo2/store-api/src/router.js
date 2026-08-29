import store, { AccountLedger } from "./index.js";
import {
  freeSourcesResponse,
  freeSubscriptionResponse,
  refreshFreeCatalog,
} from "./free-catalog.js";
import {
  requireTelegramSession,
  telegramAuthRouter,
} from "./telegram-auth.js";

export { AccountLedger };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const authResponse = await telegramAuthRouter(request, env);
    if (authResponse) return authResponse;
    if (request.method === "GET" && url.pathname === "/v1/free/subscription") {
      const auth = await requireTelegramSession(request, env);
      if (!auth.ok) return authError(auth);
      return freeSubscriptionResponse(env, ctx);
    }
    if (request.method === "GET" && url.pathname === "/v1/free/sources") {
      const auth = await requireTelegramSession(request, env, {
        requireMember: false,
        ownerOnly: true,
      });
      if (!auth.ok) return authError(auth);
      return freeSourcesResponse(env, ctx);
    }
    return store.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshFreeCatalog(env, { discover: true }));
  },
};

function authError(auth) {
  return Response.json(
    { error: auth.error },
    {
      status: auth.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
