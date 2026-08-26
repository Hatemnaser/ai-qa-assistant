import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

type PackageManifest = {
  scripts?: Record<string, string>;
};

const apiPackagePath = fileURLToPath(new URL("../package.json", import.meta.url));
const rootPackagePath = fileURLToPath(new URL("../../../package.json", import.meta.url));
const renderCronExamplePath = fileURLToPath(
  new URL("../../../ops/render-cron-services.example.yaml", import.meta.url)
);

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, "utf8")) as PackageManifest;
}

describe("compiled operations entrypoints", () => {
  it("separates compiled production commands from local TypeScript commands", async () => {
    const [apiPackage, rootPackage] = await Promise.all([
      readManifest(apiPackagePath),
      readManifest(rootPackagePath),
    ]);

    assert.equal(
      apiPackage.scripts?.["cleanup:retention"],
      "node dist/scripts/cleanup-retention.js"
    );
    assert.equal(
      apiPackage.scripts?.["assets:cleanup"],
      "node dist/scripts/cleanup-assets.js"
    );
    assert.equal(
      apiPackage.scripts?.["cleanup:retention:dev"],
      "tsx src/scripts/cleanup-retention.ts"
    );
    assert.equal(
      apiPackage.scripts?.["assets:cleanup:dev"],
      "tsx src/scripts/cleanup-assets.ts"
    );
    assert.equal(
      apiPackage.scripts?.["smoke:read-only"],
      "node dist/scripts/smoke-target.js --mode=read-only"
    );
    assert.equal(
      apiPackage.scripts?.["smoke:authenticated-mutation"],
      "node dist/scripts/smoke-target.js --mode=authenticated-mutation"
    );
    assert.equal(
      apiPackage.scripts?.["smoke:read-only:dev"],
      "tsx src/scripts/smoke-target.ts --mode=read-only"
    );
    assert.equal(
      apiPackage.scripts?.["smoke:authenticated-mutation:dev"],
      "tsx src/scripts/smoke-target.ts --mode=authenticated-mutation"
    );
    assert.equal(
      apiPackage.scripts?.["smoke:r2"],
      "node dist/scripts/smoke-r2.js --mode=eu-r2-mutation"
    );
    assert.equal(
      apiPackage.scripts?.["smoke:r2:dev"],
      "tsx src/scripts/smoke-r2.ts --mode=eu-r2-mutation"
    );
    assert.equal(
      rootPackage.scripts?.["cleanup:retention"],
      "npm --prefix apps/api run cleanup:retention"
    );
    assert.equal(
      rootPackage.scripts?.["assets:cleanup"],
      "npm --prefix apps/api run assets:cleanup"
    );
    assert.equal(
      rootPackage.scripts?.["cleanup:retention:dev"],
      "npm --prefix apps/api run cleanup:retention:dev"
    );
    assert.equal(
      rootPackage.scripts?.["assets:cleanup:dev"],
      "npm --prefix apps/api run assets:cleanup:dev"
    );
    assert.equal(
      rootPackage.scripts?.["smoke:read-only"],
      "npm --prefix apps/api run smoke:read-only"
    );
    assert.equal(
      rootPackage.scripts?.["smoke:authenticated-mutation"],
      "npm --prefix apps/api run smoke:authenticated-mutation"
    );
    assert.equal(
      rootPackage.scripts?.["smoke:r2"],
      "npm --prefix apps/api run smoke:r2"
    );
    assert.equal(
      rootPackage.scripts?.["smoke:r2:dev"],
      "npm --prefix apps/api run smoke:r2:dev"
    );
  });

  it("keeps all runners inside the TypeScript compiler source root", async () => {
    await Promise.all([
      access(fileURLToPath(new URL("../src/scripts/cleanup-retention.ts", import.meta.url))),
      access(fileURLToPath(new URL("../src/scripts/cleanup-assets.ts", import.meta.url))),
      access(fileURLToPath(new URL("../src/scripts/smoke-target.ts", import.meta.url))),
      access(fileURLToPath(new URL("../src/scripts/smoke-r2.ts", import.meta.url))),
    ]);
  });

  it("keeps Render cron services on compiled production commands", async () => {
    const renderCronExample = await readFile(renderCronExamplePath, "utf8");

    assert.match(
      renderCronExample,
      /startCommand: npm --prefix apps\/api run cleanup:retention(?:\r?\n|$)/
    );
    assert.match(
      renderCronExample,
      /startCommand: npm --prefix apps\/api run assets:cleanup(?:\r?\n|$)/
    );
    assert.doesNotMatch(renderCronExample, /startCommand:.*(?:tsx|:dev)/);
  });
});
