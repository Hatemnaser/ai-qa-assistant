import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAppRoute } from "../src/router/useAppRoute.ts";

describe("app route parsing", () => {
  it("recognizes verify-email hash and direct path routes", () => {
    assert.equal(
      parseAppRoute({
        hash: "#/verify-email?token=verification-token",
        pathname: "/",
      }),
      "verify-email"
    );
    assert.equal(
      parseAppRoute({
        hash: "",
        pathname: "/verify-email",
      }),
      "verify-email"
    );
  });
});
