import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AccountRepository } from "../src/modules/account/account.types.ts";
import { createAccountService } from "../src/modules/account/account.service.ts";

describe("account service", () => {
  it('retains account data until requested browser termination is physically confirmed',async()=>{
    const deleted:string[]=[];let confirmed=false;
    const service=createAccountService({repository:createRepository(deleted),security:{verifyPassword:async()=>true},requireBrowserStop:async user=>{assert.equal(user,'user-1');return confirmed;}});
    await assert.rejects(service.deleteAccount('user-1',{currentPassword:'correct password'}),(error:unknown)=>hasErrorCode(error,'BROWSER_STOP_REQUIRED'));
    assert.deepEqual(deleted,[]);confirmed=true;await service.deleteAccount('user-1',{currentPassword:'correct password'});assert.deepEqual(deleted,['user-1']);
  });
  it("requires the current password before deleting account data", async () => {
    const deletedUserIds: string[] = [];
    const service = createAccountService({
      repository: createRepository(deletedUserIds),
      security: {
        verifyPassword: async (password, passwordHash) =>
          password === "correct password" && passwordHash === "stored-hash",
      },
    });

    await assert.rejects(
      () => service.deleteAccount("user-1", { currentPassword: "wrong password" }),
      (error: unknown) => hasErrorCode(error, "CURRENT_PASSWORD_INVALID")
    );
    assert.deepEqual(deletedUserIds, []);
  });

  it("deletes the authenticated account after password confirmation", async () => {
    const deletedUserIds: string[] = [];
    const service = createAccountService({
      repository: createRepository(deletedUserIds),
      security: {
        verifyPassword: async () => true,
      },
    });

    const response = await service.deleteAccount("user-1", {
      currentPassword: "correct password",
    });

    assert.deepEqual(response, { ok: true });
    assert.deepEqual(deletedUserIds, ["user-1"]);
  });

  it("fails closed when the account no longer exists", async () => {
    const service = createAccountService({
      repository: {
        async deleteAccountData() {},
        async findAccountCredentials() {
          return null;
        },
      },
      security: {
        verifyPassword: async () => true,
      },
    });

    await assert.rejects(
      () => service.deleteAccount("missing-user", { currentPassword: "password" }),
      (error: unknown) => hasErrorCode(error, "SESSION_REQUIRED")
    );
  });
});

function createRepository(deletedUserIds: string[]): AccountRepository {
  return {
    async deleteAccountData(userId) {
      deletedUserIds.push(userId);
    },
    async findAccountCredentials(userId) {
      return {
        id: userId,
        passwordHash: "stored-hash",
      };
    },
  };
}

function hasErrorCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
