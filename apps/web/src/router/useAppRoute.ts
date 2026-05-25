import { onBeforeUnmount, onMounted, ref } from "vue";

export type AuthView = "login" | "register" | "forgot-password";
export type AppRoute = "chat" | "settings" | "usage" | AuthView;

const authRoutes = new Set<AuthView>(["login", "register", "forgot-password"]);

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
    navigateToSettings,
    navigateToUsage,
  };
}

function readRoute(): AppRoute {
  const route = window.location.hash.replace(/^#\/?/, "").split("?")[0];

  if (route === "usage") return "usage";
  if (route === "settings") return "settings";

  return authRoutes.has(route as AuthView) ? (route as AuthView) : "chat";
}
