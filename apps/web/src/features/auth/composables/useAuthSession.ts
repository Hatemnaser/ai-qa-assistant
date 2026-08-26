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
  let sessionRevision = 0;

  function setAuthenticatedUser(user: AuthUser) {
    sessionRevision += 1;
    currentUser.value = user;
  }

  function clearCurrentUser() {
    sessionRevision += 1;
    currentUser.value = null;
  }

  async function loadCurrentUser() {
    const requestRevision = ++sessionRevision;

    try {
      const user = await dependencies.getCurrentUser();

      if (sessionRevision === requestRevision) {
        currentUser.value = user;
      }
    } catch {
      if (sessionRevision === requestRevision) {
        currentUser.value = null;
      }
    }

    return currentUser.value;
  }

  async function logoutCurrentUser(beforeLogout?: () => Promise<void> | void) {
    const requestRevision = ++sessionRevision;

    await beforeLogout?.();
    await dependencies.logout();

    if (sessionRevision === requestRevision) {
      currentUser.value = null;
    }
  }

  return {
    clearCurrentUser,
    currentUser,
    loadCurrentUser,
    logoutCurrentUser,
    setAuthenticatedUser,
  };
}
