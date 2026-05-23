import { ref } from "vue";

import { getCurrentUser, logout } from "../authApi";
import type { AuthUser } from "../types";

export function useAuthSession() {
  const currentUser = ref<AuthUser | null>(null);

  function setAuthenticatedUser(user: AuthUser) {
    currentUser.value = user;
  }

  async function loadCurrentUser() {
    try {
      currentUser.value = await getCurrentUser();
    } catch {
      currentUser.value = null;
    }

    return currentUser.value;
  }

  async function logoutCurrentUser(beforeLogout?: () => Promise<void> | void) {
    try {
      await beforeLogout?.();
      await logout();
    } finally {
      currentUser.value = null;
    }
  }

  return {
    currentUser,
    loadCurrentUser,
    logoutCurrentUser,
    setAuthenticatedUser,
  };
}
