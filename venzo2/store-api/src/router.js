import store, { AccountLedger } from "./index.js";
import {
  freeSourcesResponse,
  freeSubscriptionResponse,
  refreshFreeCatalog,
} from "./free-catalog.js";

export { AccountLedger };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/v1/free/subscription") {
      return freeSubscriptionResponse(env, ctx);
    }
    if (request.method === "GET" && url.pathname === "/v1/free/sources") {
      return freeSourcesResponse(env, ctx);
    }
    return store.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshFreeCatalog(env, { discover: true }));
  },
};
