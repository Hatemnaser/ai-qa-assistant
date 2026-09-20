import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAppRoute } from "../src/router/useAppRoute.ts";

describe("app route parsing", () => {
  it("adds an explicit focused home without redirecting legacy QA and project routes", () => {
    assert.equal(parseAppRoute({ hash: "#/home", pathname: "/" }), "home");
    assert.equal(parseAppRoute({ hash: "", pathname: "/home" }), "home");
    assert.equal(parseAppRoute({ hash: "#/", pathname: "/" }), "workspace");
    assert.equal(parseAppRoute({ hash: "#/projects", pathname: "/" }), "projects");
    assert.equal(parseAppRoute({ hash: "#/settings", pathname: "/" }), "settings");
  });
  it("uses the QA Workspace as the product home and keeps chat explicit", () => {
    assert.equal(parseAppRoute({ hash: "", pathname: "/" }), "workspace");
    assert.equal(parseAppRoute({ hash: "#/chat", pathname: "/" }), "chat");
  });

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
