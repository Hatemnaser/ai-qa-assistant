import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAppRoute } from "../src/router/useAppRoute.ts";

describe("app route parsing", () => {
  it("recognizes verification and reset hash routes", () => {
    assert.equal(
      parseAppRoute({
        hash: "#/verify-email?token=verification-token",
        pathname: "/",
      }),
      "verify-email"
    );
    assert.equal(
      parseAppRoute({
        hash: "#/reset-password?token=password-reset-token",
        pathname: "/",
      }),
      "reset-password"
    );
    assert.equal(
      parseAppRoute({
        hash: "",
        pathname: "/verify-email",
      }),
      "verify-email"
    );
    assert.equal(
      parseAppRoute({
        hash: "",
        pathname: "/reset-password",
      }),
      "reset-password"
    );
  });
});
