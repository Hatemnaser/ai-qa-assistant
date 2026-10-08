import { onBeforeUnmount, onMounted, ref } from "vue";

export type AuthView = "login" | "register" | "forgot-password" | "reset-password" | "verify-email";
export type AppRoute = "home" | "workspace" | "chat" | "projects" | "settings" | "usage" | AuthView;
export interface TestRouteScope {
  projectId?: string;
  sessionId?: string;
  requestId?: string;
}
export interface ProjectRouteScope {
  projectId?: string;
  view?: "conversations" | "tests";
}

const authRoutes = new Set<AuthView>([
  "login",
  "register",
  "forgot-password",
  "reset-password",
  "verify-email",
]);

export function useAppRoute() {
  const currentRoute = ref<AppRoute>(readRoute());
  const testScope = ref<TestRouteScope>(parseTestRouteScope(window.location.hash));
  const projectScope = ref<ProjectRouteScope>(parseProjectRouteScope(window.location.hash));

  function syncRoute() {
    currentRoute.value = readRoute();
    testScope.value = parseTestRouteScope(window.location.hash);
    projectScope.value = parseProjectRouteScope(window.location.hash);
  }

  function navigateToAuth(view: AuthView) {
    window.location.hash = `/${view}`;
  }

  function navigateToChat(scope: TestRouteScope = {}) {
    window.location.hash = buildSessionRoute(scope);
  }

  function navigateToHome() {
    window.location.hash = "/home";
  }

  function navigateToWorkspace(scope: TestRouteScope = {}) {
    window.location.hash = buildTestRoute(scope);
  }

  function navigateToUsage() {
    window.location.hash = "/usage";
  }

  function navigateToProjects(scope: ProjectRouteScope = {}) {
    window.location.hash = buildProjectRoute(scope);
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
    testScope,
    projectScope,
    navigateToAuth,
    navigateToChat,
    navigateToHome,
    navigateToProjects,
    navigateToSettings,
    navigateToUsage,
    navigateToWorkspace,
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

  if (route === "home") return "home";
  if (route === "projects") return "projects";
  if (route === "chat") return "chat";
  if (route === "usage") return "usage";
  if (route === "settings") return "settings";
  if (route === "tests") return "workspace";

  return authRoutes.has(route as AuthView) ? (route as AuthView) : "workspace";
}

export function parseTestRouteScope(hash: string): TestRouteScope {
  const [route, query] = hash.replace(/^#\/?/, "").split("?");
  if (route !== "tests" && route !== "chat" && route !== "") return {};
  const params = new URLSearchParams(query || "");
  const projectId = routeId(params.get("projectId"));
  // A test is never restored outside its explicit project boundary.
  if (route !== "chat" && !projectId) return {};
  return {
    projectId,
    sessionId: routeId(params.get("sessionId")),
    requestId: routeId(params.get("requestId")),
  };
}

export function buildSessionRoute(scope: TestRouteScope = {}): string {
  const params = new URLSearchParams();
  if (routeId(scope.sessionId)) params.set("sessionId", scope.sessionId!);
  if (routeId(scope.projectId)) params.set("projectId", scope.projectId!);
  if (routeId(scope.requestId)) params.set("requestId", scope.requestId!);
  return `/chat${params.size ? `?${params}` : ""}`;
}

export function buildTestRoute(scope: TestRouteScope = {}): string {
  const params = new URLSearchParams();
  if (routeId(scope.projectId)) {
    params.set("projectId", scope.projectId!);
    if (routeId(scope.sessionId)) params.set("sessionId", scope.sessionId!);
    if (routeId(scope.requestId)) params.set("requestId", scope.requestId!);
  }
  return `/tests${params.size ? `?${params}` : ""}`;
}

function routeId(value: string | null | undefined): string | undefined {
  return value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
}

export function parseProjectRouteScope(hash: string): ProjectRouteScope {
  const [route, query] = hash.replace(/^#\/?/, "").split("?");
  if (route !== "projects") return {};
  const params = new URLSearchParams(query || "");
  return { projectId: routeId(params.get("projectId")), view: params.get("view") === "tests" ? "tests" : "conversations" };
}

export function buildProjectRoute(scope: ProjectRouteScope = {}): string {
  const params = new URLSearchParams();
  if (scope.view === "tests") params.set("view", "tests");
  if (routeId(scope.projectId)) params.set("projectId", scope.projectId!);
  return `/projects${params.size ? `?${params}` : ""}`;
}
