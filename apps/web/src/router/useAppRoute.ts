import { onBeforeUnmount, onMounted, ref } from "vue";

export type AuthView = "login" | "register" | "forgot-password" | "verify-email";
export type AppRoute = "chat" | "projects" | "settings" | "usage" | AuthView;

const authRoutes = new Set<AuthView>(["login", "register", "forgot-password", "verify-email"]);

export function useAppRoute() {
  const currentRoute = ref<AppRoute>(readRoute());

  function syncRoute() {
    currentRoute.value = readRoute();
  }

  function navigateToAuth(view: AuthView) {
    window.location.hash = `/${view}`;
  }

  function navigateToChat() {
    window.location.hash = "/";
  }

  function navigateToUsage() {
    window.location.hash = "/usage";
  }

  function navigateToProjects() {
    window.location.hash = "/projects";
  }

  function navigateToSettings() {
    window.location.hash = "/settings";
  }

  onMounted(() => {
    window.addEventListener("hashchange", syncRoute);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("hashchange", syncRoute);
  });

  return {
    currentRoute,
    navigateToAuth,
    navigateToChat,
    navigateToProjects,
    navigateToSettings,
    navigateToUsage,
  };
}

function readRoute(): AppRoute {
  return parseAppRoute({
    hash: window.location.hash,
    pathname: window.location.pathname,
  });
}

export function parseAppRoute(input: { hash: string; pathname: string }): AppRoute {
  const hashRoute = input.hash.replace(/^#\/?/, "").split("?")[0];
  const pathRoute = input.pathname.replace(/^\/?/, "").split("?")[0];
  const route = hashRoute || pathRoute;

  if (route === "projects") return "projects";
  if (route === "usage") return "usage";
  if (route === "settings") return "settings";

  return authRoutes.has(route as AuthView) ? (route as AuthView) : "chat";
}
