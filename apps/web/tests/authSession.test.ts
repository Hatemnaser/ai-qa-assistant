import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { useAuthSession } from "../src/features/auth/composables/useAuthSession.ts";
import type { AuthUser } from "../src/features/auth/types.ts";

describe("auth session boundary", () => {
  it("does not classify the initial unresolved identity as a confirmed guest", async () => {
    const currentUserRequest = deferred<AuthUser | null>();
    const session = useAuthSession({ getCurrentUser: () => currentUserRequest.promise, async logout() {} });
    assert.equal(session.currentUser.value, null);
    assert.equal(session.authLoading.value, true);
    const loading = session.loadCurrentUser();
    assert.equal(session.authLoading.value, true);
    currentUserRequest.resolve(null);
    await loading;
    assert.equal(session.currentUser.value, null);
    assert.equal(session.authLoading.value, false);
    assert.equal(session.authReadError.value, false);
  });

  it("distinguishes a failed identity read from a guest and allows an explicit successful retry", async () => {
    let fail = true;
    const session = useAuthSession({
      async getCurrentUser() { if (fail) throw new Error('offline'); return null; }, async logout() {},
    });
    await session.loadCurrentUser();
    assert.equal(session.authLoading.value, false, 'A failed read must not leave an endless loading state');
    assert.equal(session.authReadError.value, true);
    fail = false;
    await session.loadCurrentUser();
    assert.equal(session.authLoading.value, false);
    assert.equal(session.authReadError.value, false);
    assert.equal(session.currentUser.value, null);
  });

  it("does not let a stale failed identity read lock a newer authenticated session", async () => {
    const currentUserRequest = deferred<AuthUser | null>();
    const session = useAuthSession({ getCurrentUser: () => currentUserRequest.promise, async logout() {} });
    const loading = session.loadCurrentUser();
    session.setAuthenticatedUser(authUser('new-user'));
    currentUserRequest.reject(new Error('late offline'));
    await loading;
    assert.equal(session.currentUser.value?.id, 'new-user');
    assert.equal(session.authLoading.value, false);
    assert.equal(session.authReadError.value, false);
  });

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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve,
    reject,
  };
}
