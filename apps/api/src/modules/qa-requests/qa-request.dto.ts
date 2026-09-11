export function toPublicQaRequest(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const executions = arrayOfRecords(record.executions);
  const recipes = arrayOfRecords(record.executionRecipes);
  const artifacts = arrayOfRecords(record.artifacts);
  const itemCountByArtifact = new Map(
    artifacts.map((artifact) => [artifact.id, Array.isArray(artifact.items) ? artifact.items.length : 0])
  );
  const runs = arrayOfRecords(record.runs).map((run) => {
    const rawJob = asRecord(run.executionJob);
    const results = Array.isArray(run.results) ? run.results : [];
    return {
      ...run,
      executionMode: rawJob ? "PLAYWRIGHT" : "CONNECTED_AGENT",
      executionJob: rawJob
        ? {
            completedAt: toIso(rawJob.completedAt),
            completedItems: results.length,
            createdAt: toIso(rawJob.createdAt),
            failureCode: rawJob.errorCode || null,
            failureMessage: rawJob.errorMessage || null,
            id: rawJob.id,
            profileKey: rawJob.profileKey,
            recipeId: rawJob.recipeId,
            runId: run.id,
            runnerRegistrationId: rawJob.runnerRegistrationId,
            status: rawJob.status,
            totalItems: itemCountByArtifact.get(run.artifactId) || 0,
            updatedAt: toIso(rawJob.updatedAt),
          }
        : null,
    };
  });
  const { executions: _privateExecutions, ...publicRecord } = record;
  return {
    ...publicRecord,
    executionRecipes: recipes.map((recipe) => ({
      artifactId: recipe.artifactId,
      assessments: recipe.assessments,
      bundle: recipe.canonicalJson,
      createdAt: toIso(recipe.createdAt),
      executorKey: recipe.executorKey,
      hash: recipe.recipeHash,
      id: recipe.id,
      items: recipe.items,
      origin: recipe.origin,
      profileManifest: recipe.profileManifest,
      profileManifestHash: recipe.profileManifestHash,
      recipeHash: recipe.recipeHash,
      requestId: recipe.requestId,
      revision: recipe.revision,
      schemaVersion: recipe.schemaVersion,
      supersedesRecipeId: recipe.supersedesRecipeId,
      title: recipe.title,
    })),
    operations: executions.map((operation) => ({
      artifactId: operation.artifactId || null,
      attempts: operation.attempts,
      availableAt: operation.status === "PENDING" ? toIso(operation.availableAt) : null,
      completedAt: toIso(operation.completedAt),
      errorCode: operation.errorCode || null,
      kind: operation.kind,
      operationId: operation.id,
      recipeId: operation.recipeId || null,
      requestId: operation.requestId,
      status: operation.status,
    })),
    runs,
  };
}

function arrayOfRecords(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)))
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toIso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}
