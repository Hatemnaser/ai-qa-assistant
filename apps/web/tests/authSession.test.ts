import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { useAuthSession } from "../src/features/auth/composables/useAuthSession.ts";
import type { AuthUser } from "../src/features/auth/types.ts";

describe("auth session boundary", () => {
  it("does not let a stale current-user request replace a newer login", async () => {
    const currentUserRequest = deferred<AuthUser | null>();
    const session = useAuthSession({
      getCurrentUser: () => currentUserRequest.promise,
      async logout() {},
    });

    const loading = session.loadCurrentUser();
    session.setAuthenticatedUser(authUser("new-user"));
    currentUserRequest.resolve(authUser("old-user"));

    assert.equal((await loading)?.id, "new-user");
    assert.equal(session.currentUser.value?.id, "new-user");
  });

  it("keeps the authenticated user when server logout fails", async () => {
    const session = useAuthSession({
      async getCurrentUser() {
        return null;
      },
      async logout() {
        throw new Error("network unavailable");
      },
    });
    session.setAuthenticatedUser(authUser("user-1"));

    await assert.rejects(session.logoutCurrentUser(), /network unavailable/);

    assert.equal(session.currentUser.value?.id, "user-1");
  });

  it("clears the authenticated user only after server logout succeeds", async () => {
    const logoutRequest = deferred<void>();
    const session = useAuthSession({
      async getCurrentUser() {
        return null;
      },
      logout: () => logoutRequest.promise,
    });
    session.setAuthenticatedUser(authUser("user-1"));

    const loggingOut = session.logoutCurrentUser();
    assert.equal(session.currentUser.value?.id, "user-1");

    logoutRequest.resolve();
    await loggingOut;

    assert.equal(session.currentUser.value, null);
  });
});

function authUser(id: string): AuthUser {
  return {
    createdAt: "2026-08-19T00:00:00.000Z",
    email: `${id}@example.com`,
    emailVerifiedAt: "2026-08-19T00:00:00.000Z",
    id,
    locale: "en",
    name: id,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return {
    promise,
    resolve,
  };
}
