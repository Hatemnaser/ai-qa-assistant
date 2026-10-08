import { ref } from "vue";

import { getCurrentUser, logout } from "../authApi";
import type { AuthUser } from "../types";

export interface AuthSessionDependencies {
  getCurrentUser(): Promise<AuthUser | null>;
  logout(): Promise<unknown>;
}

const defaultDependencies: AuthSessionDependencies = {
  getCurrentUser,
  logout,
};

export function useAuthSession(dependencies: AuthSessionDependencies = defaultDependencies) {
  const currentUser = ref<AuthUser | null>(null);
  const authLoading = ref(true);
  const authReadError = ref(false);
  let sessionRevision = 0;

  function setAuthenticatedUser(user: AuthUser) {
    sessionRevision += 1;
    currentUser.value = user;
    authLoading.value = false;
    authReadError.value = false;
  }

  function clearCurrentUser() {
    sessionRevision += 1;
    currentUser.value = null;
    authLoading.value = false;
    authReadError.value = false;
  }

  async function loadCurrentUser() {
    const requestRevision = ++sessionRevision;
    authLoading.value = true;
    authReadError.value = false;

    try {
      const user = await dependencies.getCurrentUser();

      if (sessionRevision === requestRevision) {
        currentUser.value = user;
      }
    } catch {
      if (sessionRevision === requestRevision) {
        currentUser.value = null;
        authReadError.value = true;
      }
    } finally {
      if (sessionRevision === requestRevision) authLoading.value = false;
    }

    return currentUser.value;
  }

  async function logoutCurrentUser(beforeLogout?: () => Promise<void> | void) {
    const requestRevision = ++sessionRevision;

    await beforeLogout?.();
    await dependencies.logout();

    if (sessionRevision === requestRevision) {
      currentUser.value = null;
      authLoading.value = false;
      authReadError.value = false;
    }
  }

  return {
    authLoading,
    authReadError,
    clearCurrentUser,
    currentUser,
    loadCurrentUser,
    logoutCurrentUser,
    setAuthenticatedUser,
  };
}
