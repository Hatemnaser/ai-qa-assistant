# Phase 06A — model selection

Closed locally after independent repair review on 2026-10-14; read
`PHASE_06A_CLOSEOUT.md`. The owner authorized 06B. The paragraphs below remain
the dated implementation and repair history; original ledgers are unchanged.

Started 2026-10-14 after `PHASE_05_CLOSEOUT.md` and owner authorization. This is
the first Phase 06 slice, not completion of the full models/quotas/auth stage.
Independent review is required before the next slice.

The independent review found two integration gaps: inferred historical model
metadata and model-specific provider NOT_FOUND handling. The owner authorized
their repair; see `PHASE_06A_REVIEW_FIX.md` and its separate validation ledger.
Review the repaired version before accepting 06A. The results below describe
the original implementation and remain dated evidence.

The independent repair review then found that the unified session reader
bypassed the corrected message projection. Its owner-authorized repair is in
`PHASE_06A_SESSION_REVIEW_FIX.md`, with a separate validation ledger. Review
this final reader integration before accepting 06A.

That review identified a remaining distinction between native-account and
external-provider import metadata. Its local repair and regression coverage
are in `PHASE_06A_NATIVE_IMPORT_REVIEW_FIX.md`; review this repair before
accepting 06A. Previous ledgers remain unchanged.

The contract is an explicit registered model id or the reserved selection
`auto`. Explicit selection, including the omitted-model legacy default, uses
that model or returns an error. Workflow/output preference and image input
cannot silently replace it. Capability checks still happen before reservation
and generation. Auto chooses an installed, compatible model in the selected
provider, and permits bounded deduplicated fallback only for model availability
or provider-quota errors. Unsupported models/providers and other failures do
not initiate fallback. The provider never receives `auto` as a model id.

The existing model catalog/settings/composer support Auto. Account defaults
seed future drafts; current drafts retain their selection. A removed model
remains visibly unavailable rather than changing silently. Model choice stays
editable for Visual Review. Localized composer copy explains the contract, and
assistant messages show the recorded concrete model, including after reload.

Successful replies and the existing usage reconciliation use the model that
completed the request; provider attempts and the final failed attempt retain
their existing conservative accounting boundary. A response naming a different
model/provider is rejected. Durable per-attempt quota reconciliation, public
registration/email/abuse controls and browser reservation limits remain the
later Phase 06 slices. No price/catalog availability refresh or provider
integration is included.

Fresh verification is recorded in `evidence/phase-06a/validation.json`: full
verify passed with 1,906 passing tests and one existing Windows vault-journal
skip; 108 guarded disposable PostgreSQL cases and migration/dump/restore passed;
7 new model journeys and 19 existing resource/viewer journeys passed in actual
Vue/Chromium. API and web production builds passed with synthetic origins and
the existing bundle-size advisory. Providers/API/viewer responses are synthetic.
The final UI runs were isolated after checks/builds, without retries. Earlier
fixture/type/old-assertion failures are retained separately in the ledger.
Keep the existing session/QA controller and browser/login/Stop boundaries.
No working-database migration, paid API call, publication, deployment or public
activation is included; the beta remains NO_GO.
