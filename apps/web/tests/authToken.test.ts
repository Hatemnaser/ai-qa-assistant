import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLocationWithoutAuthToken,
  consumeAuthTokenFromLocation,
  readAuthTokenFromLocation,
} from "../src/features/auth/authToken.ts";

describe("auth token links", () => {
  it("reads a token from a hash route before the ordinary search string", () => {
    assert.equal(
      readAuthTokenFromLocation({
        hash: "#/reset-password?token=hash-token",
        search: "?token=search-token",
      }),
      "hash-token"
    );
  });

  it("supports direct path query strings and missing tokens", () => {
    assert.equal(
      readAuthTokenFromLocation({ hash: "", search: "?token=search-token" }),
      "search-token"
    );
    assert.equal(readAuthTokenFromLocation({ hash: "#/reset-password", search: "" }), "");
  });

  it("removes a consumed hash token while preserving unrelated URL state", () => {
    let replacement = "";
    const token = consumeAuthTokenFromLocation(
      {
        hash: "#/reset-password?token=secret-token&source=email",
        pathname: "/",
        search: "?locale=de",
      },
      (relativeUrl) => {
        replacement = relativeUrl;
      }
    );

    assert.equal(token, "secret-token");
    assert.equal(replacement, "/?locale=de#/reset-password?source=email");
  });

  it("removes a direct-path token without rewriting the browser when none exists", () => {
    assert.equal(
      buildLocationWithoutAuthToken({
        hash: "",
        pathname: "/reset-password",
        search: "?token=secret-token&locale=en",
      }),
      "/reset-password?locale=en"
    );

    let replacements = 0;
    assert.equal(
      consumeAuthTokenFromLocation(
        {
          hash: "#/reset-password",
          pathname: "/",
          search: "",
        },
        () => {
          replacements += 1;
        }
      ),
      ""
    );
    assert.equal(replacements, 0);
  });
});
