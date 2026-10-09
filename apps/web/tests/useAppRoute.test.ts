import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTestRoute, buildProjectRoute, parseProjectRouteScope, parseAppRoute, parseTestRouteScope } from "../src/router/useAppRoute.ts";

describe("app route parsing", () => {
  it("round trips shared project details in either host while preserving legacy projects", () => {
    assert.equal(buildProjectRoute(), "/projects");
    assert.deepEqual(parseProjectRouteScope("#/projects"), { projectId: undefined, view: "conversations" });
    for (const view of ["tests", "conversations"] as const) {
      const scope = { view, projectId: "shared / عربي" };
      assert.deepEqual(parseProjectRouteScope(`#${buildProjectRoute(scope)}`), scope);
    }
    assert.deepEqual(parseProjectRouteScope("#/tests?view=tests&projectId=p1"), {});
    assert.equal(parseProjectRouteScope("#/projects?projectId=%00invalid&view=bad").projectId, undefined);
  });
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
    assert.equal(parseAppRoute({ hash: "#/tests?projectId=one", pathname: "/" }), "workspace");
  });

  it("round trips explicit project, session and request boundaries without writes", () => {
    const scope = { projectId: "project +/ع", sessionId: "session:2", requestId: "request/3" };
    assert.deepEqual(parseTestRouteScope(`#${buildTestRoute(scope)}`), scope);
    assert.equal(buildTestRoute(), "/tests");
    assert.deepEqual(parseTestRouteScope("#/?projectId=one&requestId=old"), { projectId: "one", sessionId: undefined, requestId: "old" });
  });

  it("ignores session scopes on ordinary or auth routes and unscoped/malformed IDs", () => {
    assert.deepEqual(parseTestRouteScope("#/chat?projectId=one&sessionId=two"), { projectId: 'one', sessionId: 'two', requestId: undefined });
    assert.deepEqual(parseTestRouteScope("#/chat?sessionId=two"), { projectId: undefined, sessionId: 'two', requestId: undefined });
    assert.deepEqual(parseTestRouteScope("#/tests?sessionId=two"), {});
    assert.deepEqual(parseTestRouteScope("#/tests?projectId=%00bad"), {});
    assert.deepEqual(parseTestRouteScope(`#/tests?projectId=${"a".repeat(257)}`), {});
    assert.equal(buildTestRoute({ sessionId: "orphan" }), "/tests");
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
