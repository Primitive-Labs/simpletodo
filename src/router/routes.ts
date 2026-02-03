import { config } from "@/config/envConfig";
import AppLayout from "@/layouts/AppLayout.vue";
import LoginLayout from "@/layouts/LoginLayout.vue";
import PrimitiveLogout from "@/components/auth/PrimitiveLogout.vue";
import PrimitiveOauthCallback from "@/components/auth/PrimitiveOauthCallback.vue";
import { createPrimitiveRouter } from "@/router/primitiveRouter";
import type { RouteRecordRaw } from "vue-router";
import { createWebHistory } from "vue-router";
import HomePage from "../pages/HomePage.vue";
import LoginPage from "../pages/LoginPage.vue";
import NotFoundPage from "../pages/NotFoundPage.vue";

const oauthCallbackPath = config.oauthRedirectUri
  ? new URL(config.oauthRedirectUri).pathname
  : "/oauth/callback";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: AppLayout,
    children: [
      {
        path: "",
        name: "home",
        component: HomePage,
        meta: {
          primitiveRouterMeta: {
            requireAuth: "member",
          },
        },
      },
    ],
  },
  {
    path: "/",
    component: LoginLayout,
    children: [
      {
        path: "login",
        name: "login",
        component: LoginPage,
      },
      {
        path: "logout",
        name: "logout",
        component: PrimitiveLogout,
        props: {
          continueRoute: "login",
        },
      },
      {
        path: oauthCallbackPath,
        name: "oauth-callback",
        component: PrimitiveOauthCallback,
        props: {
          continueRoute: "home",
          loginRoute: "login",
        },
      },
    ],
  },
  {
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: NotFoundPage,
    meta: {
      primitiveRouterMeta: {
        requireAuth: "none",
      },
    },
  },
];

const router = createPrimitiveRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  loginRouteName: "login",
});

export default router;
