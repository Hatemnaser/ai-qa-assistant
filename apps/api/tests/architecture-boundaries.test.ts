import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const CHECKER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../scripts/check-architecture-boundaries.mjs"
);

describe("architecture boundary checker", () => {
  it("accepts contracts that stay separate from repository implementations", () => {
    withFixture(
      {
        "src/modules/example/example.repository.ts": `
          import type { ExampleRepository } from "./example.types.js";
          export const exampleRepository: ExampleRepository = { find: async () => null };
        `,
        "src/modules/example/example.service.ts": `
          import { exampleRepository } from "./example.repository.js";
          import type { ExampleRepository } from "./example.types.js";
          export const load = (repository: ExampleRepository = exampleRepository) => repository.find();
        `,
        "src/modules/example/example.types.ts": `
          export interface ExampleRepository { find(): Promise<string | null>; }
        `,
      },
      ({ status, stdout, stderr }) => {
        assert.equal(status, 0, stderr);
        assert.match(stdout, /Architecture boundaries passed/);
      }
    );
  });

  it("rejects contracts declared or re-exported by concrete repositories", () => {
    withFixture(
      {
        "src/modules/example/example.repository.ts": `
          export interface ExampleRepository { find(): Promise<string | null>; }
        `,
      },
      ({ status, stderr }) => {
        assert.equal(status, 1);
        assert.match(stderr, /declares exported contract ExampleRepository/);
      }
    );

    withFixture(
      {
        "src/modules/example/example.repository.ts": `
          export { type ExampleRepository } from "./example.types.js";
        `,
        "src/modules/example/example.types.ts": `
          export interface ExampleRepository { find(): Promise<string | null>; }
        `,
      },
      ({ status, stderr }) => {
        assert.equal(status, 1);
        assert.match(stderr, /re-exports types from a concrete repository/);
      }
    );
  });

  it("rejects contract-to-implementation dependencies and concrete port imports", () => {
    withFixture(
      {
        "src/modules/example/example.repository.ts": `export const exampleRepository = {};`,
        "src/modules/example/example.types.ts": `
          import { exampleRepository } from "./example.repository.js";
          export type Example = typeof exampleRepository;
        `,
      },
      ({ status, stderr }) => {
        assert.equal(status, 1);
        assert.match(stderr, /makes a contract file depend on/);
      }
    );

    withFixture(
      {
        "src/modules/example/example.repository.ts": `export const exampleRepository = {};`,
        "src/modules/example/example.service.ts": `
          import type { ExampleRepository } from "./example.repository.js";
          export const load = (repository: ExampleRepository) => repository;
        `,
      },
      ({ status, stderr }) => {
        assert.equal(status, 1);
        assert.match(stderr, /imports ExampleRepository from concrete module/);
      }
    );
  });

  it("rejects runtime dependency cycles but ignores type-only dependencies", () => {
    withFixture(
      {
        "src/modules/example/a.ts": `import { b } from "./b.js"; export const a = b;`,
        "src/modules/example/b.ts": `import { a } from "./a.js"; export const b = a;`,
      },
      ({ status, stderr }) => {
        assert.equal(status, 1);
        assert.match(stderr, /runtime dependency cycle/);
      }
    );

    withFixture(
      {
        "src/modules/example/a.ts": `import type { B } from "./b.js"; export interface A { b: B; }`,
        "src/modules/example/b.ts": `import type { A } from "./a.js"; export interface B { a: A; }`,
      },
      ({ status, stderr }) => {
        assert.equal(status, 0, stderr);
      }
    );
  });
});

function withFixture(
  files: Record<string, string>,
  assertion: (result: ReturnType<typeof runChecker>) => void
) {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "oddpath-architecture-"));
  mkdirSync(resolve(fixtureRoot, "src"), { recursive: true });
  mkdirSync(resolve(fixtureRoot, "tests"), { recursive: true });

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const targetPath = resolve(fixtureRoot, relativePath);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, content, "utf8");
    }

    assertion(runChecker(fixtureRoot));
  } finally {
    assert.ok(fixtureRoot.startsWith(resolve(tmpdir(), "oddpath-architecture-")));
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
}

function runChecker(apiRoot: string) {
  const result = spawnSync(
    process.execPath,
    [CHECKER_PATH, "--api-root", apiRoot],
    { encoding: "utf8" }
  );

  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}
