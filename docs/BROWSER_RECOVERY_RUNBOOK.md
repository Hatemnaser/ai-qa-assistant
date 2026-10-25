# Browser recovery after an unsettled mutation

An unresolved allocationOwner intentionally prevents confirmed Stop and further claims. This procedure is for an operator with host access. It must not be used by the QA agent or by changing application status to simulate physical exit.

1. Disable new dispatch and stop the worker/registration loop. Keep the API allocation and cancellation history. Request Stop through the existing controller/API; confirm that it remains requested/unconfirmed when proof is absent.
2. Preserve the journal and sanitized execution/runtime/owner/image identities. Never publish tokens, browser state or secret configuration. Do not delete the journal to bypass capacity.
3. Establish that the old worker and any Docker API operation have actually ended. A terminated CLI alone is insufficient. If the host cannot provide that evidence, retain the fence and keep dispatch disabled. Use a controlled host/engine shutdown and subsequent recovery only under the deployment's rehearsed maintenance procedure; consider the impact on unrelated services before doing so.
4. On the quiescent host, inspect the exact owned Chrome and egress containers and private network. Kill/wait/remove existing owned resources, verify fresh absence, and exclude automatic restart policies. Identity/label mismatch, unavailable Docker or an outstanding operation blocks recovery.
5. Release only the exact execution/runtime/creator fence after the operator has established settlement. Preserve an audit record of those identities and the settlement evidence. The current implementation deliberately provides no public reset endpoint or timer-based reset. Offline journal intervention requires a reviewed deployment procedure and backup.
6. Let the existing supervisor/reaper take a fresh termination observation after the API Stop request and report it through the existing authenticated runtime exit route. Do not send a fabricated timestamp/proof or directly update PostgreSQL to STOP_CONFIRMED.
7. Confirm physical/API Stop, unchanged historical results and zero owned leftovers, then re-enable dispatch. Never resume a started recipe or human-input attempt; a retry needs a new run and approval.

The local regression covers refusal before settlement, persistence across reopen, cleanup of a late network and ordinary confirmation after a settled creator. It does not prove a specific host's daemon maintenance/recovery procedure. Record that deployment rehearsal, alert delivery and operator kill-switch verification before public activation.

## Deferred terminal failure reports

The supervisor persists interrupted-preparation failure reports in the same private
SQLite journal before sending them. Reporting retries use the original claim and
stable Idempotency-Key, including after restart; they never replay browser work.
An acknowledged failure deletes its queued reporting credentials. A rejected or
unreachable report logs `Managed failure report unconfirmed`; it must not be read
as a successful terminal receipt. While authority remains available, the worker
retries the report. After an explicit authority denial or the execution deadline,
it discards the reporting credentials and logs that API lease reconciliation is
required. Verify the API's terminal job state and the independent reapers instead
of fabricating a failure/exit receipt or starting the old execution again.

Failure receipt delivery does not confirm physical Stop or release a creator
fence. The existing Stop/exit proof and reservation reconciliation requirements
above still apply. Operational login status stays on the project-authorized
channel; the separate host cleanup channel remains restricted to status/Stop/exit
and does not grant login, acceptance or result-writing authority.

Preparation failures now retain an allowlisted `stage` and `reason` across the
private runtime response and supervisor log (`BROWSER_PREPARATION_FAILURE`). The
existing `BROWSER_SESSION_UNAVAILABLE` receipt stores a fixed safe description;
the first queued receipt remains unchanged across retry/restart. URLs, input,
cookies, tokens and raw exception text are excluded. Diagnose navigation, CDP
and input failures from these fields; `UNKNOWN/UNAVAILABLE` is explicitly
unconfirmed. A Stop-induced lease loss must not replace an existing preparation
error. Successful handoff still requires current authority. A process crash
before a reason is captured cannot establish its missing cause; use the existing
reapers and confirmed Stop workflow, and require a new approval for a new run.

An egress proxy exit with `Unhandled 'error' event` / `ECONNRESET` can make an
otherwise live Chrome fail before LOGIN. CONNECT uses a raw client socket:
disconnect handling must be installed before awaiting DNS/policy checks, including
the rejected-destination path. A client reset must terminate only its tunnel.
Regression coverage exercises reset during pending DNS, rejected destinations,
normal tunnelling and upstream cleanup. Do not compensate with longer navigation
timeouts or weaker egress rules, and do not replay the interrupted QA attempt.
Inspect the proxy's exit separately from Chrome/OOM; retain the failure receipt
and require the ordinary confirmed Stop/reconciliation before releasing capacity.
