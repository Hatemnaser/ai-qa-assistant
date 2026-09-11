-- Keep existing Recipe ids, hashes, assessments and approvals intact. Identical
-- steps for a different public Runner profile need their own reviewed revision.
BEGIN;

CREATE UNIQUE INDEX "QaExecutionRecipe_artifact_recipe_profile_key"
  ON "QaExecutionRecipe"("artifactId", "recipeHash", "profileManifestHash");

DROP INDEX "QaExecutionRecipe_artifactId_recipeHash_key";

COMMIT;
