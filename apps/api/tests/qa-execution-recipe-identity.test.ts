import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import {
  createQaExecutionRecipeRepository,
  hashCanonicalJson,
  resolveProfileManifest,
} from "../src/modules/qa-requests/qa-execution-recipes.repository.ts";
import type { SubmitQaExecutionRecipeCommand } from "../src/modules/qa-requests/qa-execution-recipes.types.ts";

const command: SubmitQaExecutionRecipeCommand = {
  actor: { kind: "USER", transport: "WEB", userId: "owner-1" },
  artifactId: "artifact-1", projectId: "project-1", requestId: "request-1",
  origin: "AGENT_PROVIDED", title: "Login checks",
  profileManifest: {
    environmentKind: "TEST", evidenceKinds: ["TEXT"], executorKey: "playwright",
    label: "Test browser", profileKey: "browser", recipeSchemaVersions: [1],
    schemaVersion: 1, valueReferences: [],
  },
  bundle: {
    schemaVersion: 1, engine: "playwright", items: [{ checklistItemId: "item-1", steps: [
      { action: "navigate", path: "/login", ref: "open", waitUntil: "domcontentloaded" },
      { action: "expect", ref: "heading", expectation: {
        kind: "visible", locator: { by: "role", role: "heading", name: "Login" },
      } },
    ] }],
  },
};

describe("Execution Recipe profile-bound identity", () => {
  it("reuses an identical bundle and manifest without another review", async () => {
    const fixture = createFixture();
    const first = await fixture.repository.submitRecipe(command);
    assert.equal(await fixture.repository.submitRecipe({
      ...command, profileManifest: resolveProfileManifest(command.profileManifest),
    }), first);
    assert.equal(fixture.recipes.length, 1);
    assert.equal(fixture.reviews.length, 1);
    assert.equal(fixture.events.length, 1);
  });

  it("creates a separately reviewed revision for identical steps on a changed manifest", async () => {
    const fixture = createFixture();
    const first = await fixture.repository.submitRecipe(command);
    const original = structuredClone(fixture.recipes[0]);
    const changed = { ...command, profileManifest: {
      ...command.profileManifest, environmentKind: "STAGING" as const,
    } };
    const second = await fixture.repository.submitRecipe(changed);
    assert.notEqual(second, first);
    assert.deepEqual(fixture.recipes[0], original);
    assert.equal(fixture.recipes[1]!.revision, 2);
    assert.equal(fixture.recipes[1]!.recipeHash, fixture.recipes[0]!.recipeHash);
    assert.notEqual(fixture.recipes[1]!.profileManifestHash, fixture.recipes[0]!.profileManifestHash);
    assert.equal(fixture.reviews.length, 2);
    assert.equal(await fixture.repository.submitRecipe(changed), second);
    assert.equal(await fixture.repository.submitRecipe(command), first);
    assert.equal(fixture.recipes.length, 2);
    assert.equal(fixture.reviews.length, 2);
  });

  it("never reuses a legacy row with no profile binding", async () => {
    const fixture = createFixture();
    fixture.recipes.push({
      artifactId: command.artifactId, id: "legacy", revision: 1,
      recipeHash: hashCanonicalJson(command.bundle), profileManifestHash: null,
    });
    assert.notEqual(await fixture.repository.submitRecipe(command), "legacy");
    assert.equal(fixture.recipes[1]!.revision, 2);
    assert.equal(fixture.reviews.length, 1);
  });
});

function createFixture() {
  interface RecipeRow {
    artifactId: string; id: string; revision: number; recipeHash: string;
    profileManifestHash: string | null;
  }
  const recipes: RecipeRow[] = [];
  const reviews: unknown[] = [];
  const events: unknown[] = [];
  const tx = {
    async $executeRaw() { return 0; },
    qaRequest: { async findFirst() {
      return { id: command.requestId, phase: "READY_TO_RUN", selectedArtifactId: command.artifactId };
    } },
    qaArtifact: { async findFirst() {
      return { id: command.artifactId, items: [{ id: "item-1", title: "Login", evidenceRequirements: [
        { id: "requirement-1", kind: "TEXT", required: true, description: "Observed heading" },
      ] }] };
    } },
    qaExecutionRecipe: {
      async findFirst({ where, orderBy }: {
        where: Partial<RecipeRow>; orderBy?: { revision: string };
      }) {
        const matches = recipes.filter((row) => Object.entries(where).every(
          ([key, value]) => row[key as keyof RecipeRow] === value,
        ));
        return (orderBy ? matches.sort((a, b) => b.revision - a.revision) : matches)[0] || null;
      },
      async create({ data }: { data: Omit<RecipeRow, "id"> }) {
        const row = { ...data, id: `recipe-${recipes.length + 1}` };
        recipes.push(row);
        return row;
      },
    },
    qaGenerationExecution: { async create({ data }: { data: unknown }) { reviews.push(data); } },
    qaWorkflowEvent: {
      async findFirst() { return events.length ? { sequence: events.length } : null; },
      async create({ data }: { data: unknown }) { events.push(data); },
    },
  };
  const database = { async $transaction<T>(action: (transaction: typeof tx) => Promise<T>) {
    return action(tx);
  } } as unknown as typeof prisma;
  return { events, recipes, reviews, repository: createQaExecutionRecipeRepository(database) };
}
