import store, { AccountLedger } from "./index.js";
import { phaseOneRouter, requireOwnerSession } from "./admin-phase1.js";
import {
  freeSourcesResponse,
  freeSubscriptionResponse,
  refreshFreeCatalog,
} from "./free-catalog.js";
import { telegramAuthRouter } from "./telegram-auth.js";

export { AccountLedger };
export { AdminState } from "./admin-state.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const adminResponse = await phaseOneRouter(request, env);
    if (adminResponse) return adminResponse;
    const authResponse = await telegramAuthRouter(request, env);
    if (authResponse) return authResponse;
    if (request.method === "GET" && url.pathname === "/v1/free/subscription") {
      return freeSubscriptionResponse(env, ctx);
    }
    if (request.method === "GET" && url.pathname === "/v1/free/sources") {
      const auth = await requireOwnerSession(request, env);
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
