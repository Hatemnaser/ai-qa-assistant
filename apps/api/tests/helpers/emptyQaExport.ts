// Existing non-QA portability fixtures explicitly contain no QA history.
const empty={async count(){return 0;},async findMany(){return [];}};
export const emptyQaExport={
 qaRequest:empty,qaArtifact:empty,qaChecklistItem:empty,qaRun:empty,qaCheckResult:empty,qaEvidence:empty,qaHumanReview:empty,
 qaWorkflowEvent:empty,qaExecutionRecipe:empty,qaEvidenceAsset:empty,qaEvidenceRequirement:empty,qaChecklistAssessment:empty,
 qaExecutionRecipeAssessment:empty,qaContextSnapshot:empty,qaImportedArchive:empty,qaReadinessCandidate:empty,qaReadinessEvaluation:empty,async $queryRaw(){return [{bytes:0n}];},
};
