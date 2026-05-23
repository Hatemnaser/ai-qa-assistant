import { onBeforeUnmount, onMounted, ref } from "vue";

export type AuthView = "login" | "register" | "forgot-password";
export type AppRoute = "chat" | AuthView;

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
  };
}

function readRoute(): AppRoute {
  const route = window.location.hash.replace(/^#\/?/, "").split("?")[0];

  return authRoutes.has(route as AuthView) ? (route as AuthView) : "chat";
}
