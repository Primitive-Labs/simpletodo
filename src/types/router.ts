import "vue-router";
import type { PrimitiveRouterMeta } from "../router/primitiveRouter";

declare module "vue-router" {
  interface RouteMeta {
    /**
     * App-specific routing metadata.
     *
     * When omitted, the route is treated as public (equivalent to
     * `{ requireAuth: "none" }`).
     */
    primitiveRouterMeta?: PrimitiveRouterMeta;
  }
}
