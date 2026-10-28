# Phase 08A — existing foundations and launch gaps

2026-10-29: the reviewed source checkpoint and remaining private WSS gate are
recorded at the top of [NEXT_STEPS.md](NEXT_STEPS.md). Public web stays CLOSED;
Phase08 remains NOT ACCEPTED. Earlier dated entries below are historical.

2026-10-28 current state: PUBLIC WEB CLOSED; private readiness round implemented,
pending independent acceptance. OCI TCP80/443 remain removed and gateway80/443
remain bound to127.0.0.1. SSH22 remains available. Do not reopen web ingress or
activate Access/Tunnel without a new owner instruction. HTTP01 renewal remains
blocked by this deliberate closure; a compatible renewal design is still needed.

Existing maintenance and FULL_SYSTEM backup profiles now run persistently on the
synthetic Oracle staging. Periodic reconciliation/retention, verified encrypted
backup, restart scheduling and local health passed implementation checks. One
encrypted data/escrow pair was copied to the owner's PC and restored into fresh
local PostgreSQL using the already protected recovery handoff; quarantine,
restart, wrong-key rejection and nonempty-target refusal passed. This is a manual
off-host proof, not an automatic off-host service or live recovery authorization.

Resource-tab preferences now survive navigation/reload within the same browser
tab: account/project/session scoped IDs only, bounded24 records/12 tabs, ignored
after24h and cleared on logout/account deletion in that browser tab. No viewer
URL/grant or QA authority is stored; owned catalogs are revalidated. Actual
private ARM64 UI checks cover two sessions, reload, mobile/keyboard and no grant
replay. QA controller, quotas and browser sandbox are unchanged.

Review packet: C:/Users/hatem/Documents/Codex/oddpath-private-readiness-round-20261028/REPORT.md.
The latest complete execution on the final secret bindings remains unverified:
the existing three-allocation daily browser allowance was exhausted; do not reset
or raise it to pass. Next: independent MR-style review of the full working tree
and these receipts, then owner-authorized commit/push. Real mail journeys,
automatic off-host continuity, protected-access/renewal, broader UX/legal and
release gates remain open. No new paid service, public access, commit or push.
Earlier dated sections are history. Phase08 NOT ACCEPTED; Public Release NO_GO.


## 2026-10-28 — private operations and session-layout implementation

Current normal topology is ten containers: the six existing application/control
services plus maintenance, full-backup, vault-exporter and runtime-exporter.
All four additions use the existing pinned operations image and existing opt-in
Compose profiles; no new scheduler/runtime was designed. Exporters have no
network, the aggregator has no Docker socket/live SQLite mount, all additions are
read-only with no published ports. Only the trusted gateway was replaced for the
new frontend; its actual loopback bindings and all three trusted TLS names were
checked. The trusted UI observer used host networking only to reach that private
gateway with normal CA/hostname checks; tenant Chrome isolation was unchanged.

Append self-hosted.operations.compose.yml and self-hosted.full-backup.compose.yml
after the five currently installed overlays in /opt/oddpath/staging-closed/deploy;
use /etc/oddpath/staging-closed/compose.env and profiles maintenance/full-backup.
Do not select the old database-only backup profile for these journals. Separate
SELECT-only backup credentials, data/escrow keys, state/archive volumes and the
two existing private export-socket volumes are configured under the same private
installation. The two unused volumes from setup were removed; original archives
and volumes were preserved. Scheduling is reconciliation60s, retention15min,
archive pruning1h and full backup24h from the durable successful run. Restart
preserved scheduling without creating a redundant backup. Local Docker health
and durable failure records are active; external notification is not configured.

The off-host copy is manually held outside Git on the owner's PC, with owner and
SYSTEM access only. The paired archives and existing protected handoff restored
the synthetic2 users/3 jobs/3 attempts into a new local PostgreSQL16 database;
zero active reservations/usage/email were added. The restore remained quarantined
after PostgreSQL restart and the current operational database guard rejected it.
All new local test resources were removed. No source database access was needed
during that restore. Current consumption/deletion continuity and actual live
recovery still require the existing independent recovery gates.

Tab preferences use sessionStorage, not IndexedDB or a new persistence service.
They contain only allowlisted resource IDs, pin order, selection and hidden state;
titles, payloads, iframe URLs, capabilities, approvals and modal state are omitted.
There is no cross-device/cross-browser-tab restoration guarantee. Unavailable or
corrupt storage falls back to ordinary in-memory tabs. This is a bounded UX
improvement, not acceptance of the entire Codex-like workspace vision.

Read the review packet for test counts, failed fixture attempts, unchanged
evidence and explicit unverified gates. No Phase08/Public Release acceptance.


## 2026-10-28 — account-limited staging on trusted HTTPS

The unavailable TLS edge has bounded acceptance GO in
`C:/Users/hatem/Documents/Codex/oddpath-staging-tls-acceptance-20261028/REVIEW.md`.
The owner then requested the next implementation: persistent account-limited
staging. The current slice serves the real frontend/API/viewer on the exact
three staging origins over trusted443. It awaits independent acceptance.
Phase08 NOT ACCEPTED; Public Release NO_GO.

Only two synthetic accounts exist; browser admission is the exact `stack-owner`
ID. Registration, paid AI/embeddings, automatic QA generation, legacy dispatch,
saved login, private assets and imports remain disabled by the existing closed
overlay. SMTP is an intentionally unreachable loopback fixture with no Brevo
credential; application email delivery/reset are not usable/accepted. The
synthetic account bootstrap is test data, not evidence of public onboarding,
email ownership verification or legal acceptance. Do not put real user data,
credentials for tested sites, payments or provider keys into this staging slice.

The only added deployment files are
`deploy/self-hosted.staging.compose.yml` and `deploy/staging-http01.conf`.
Add them after the existing base, stack, closed-browser and TLS-directory
overlays. Bindings default to loopback; the owner-authorized instance explicitly
selects IPv4 public80/443. HTTP01 stays challenge-only on80 and shares the
accepted renewal/deployment hook; HTTPS serves the full reviewed stack. The
gateway retains the name configured in that hook. Internal supervisor discovery
uses `https://api-staging-oddpath.eluthira.com:8443`; public URLs use443. The
gateway control-network alias is validated with the system public CA bundle,
without browser trust bypass or changing the existing target sandbox.

The new deployment project is `oddpath-staging-closed`; its dedicated external
volumes are `oddpath-staging-closed-pg`, `oddpath-staging-closed-vault` and
`oddpath-staging-closed-journal`. Normal idle topology is six containers: private
PostgreSQL, API, HTTPS gateway, browser supervisor, runtime reaper and API reaper.
Individual browser/egress containers exist only during a bounded approved test.
API/PG/VNC/CDP/control have no host publishing. Supervisor/reaper Docker socket
authority remains restricted to the trusted operator components; no socket is
mounted into the API, ingress or tenant Chrome.

Root-owned deployment files are installed under `/opt/oddpath/staging-closed/deploy`
and private configuration under `/etc/oddpath/staging-closed` (0700). The Compose
environment is `/etc/oddpath/staging-closed/compose.env`; source files are the five
overlays listed above in that order. Ordinary Compose `up` did not rebind every
existing secret mount when its host file moved: the operator completed an explicit
`--force-recreate` with unchanged volumes/keys and verified all six actual mounts.
Do not delete the old operator directory until those bindings have been inspected.
The external implementation report is at
`C:/Users/hatem/Documents/Codex/oddpath-persistent-staging-20261028/REPORT.md`.
The deployment uses pinned, previously accepted ARM64 images, PostgreSQL16 and
35 current migrations, separate admin/migrator/runtime credentials and durable
journals. Credentials are host-local private files, never Git/evidence exports.

Actual public UI journeys exercise approval, manual-preparation viewer/embedded
resource, completed QA, Stop and supervisor crash. Streams and old viewer cookies
are revoked, reservations released after physical exit, and Reload cannot replay
the terminal attempts. Private/public HTTP checks cover CSRF, ownership/admission,
closed registration and trusted origins. Rollback to the old503 edge and explicit
resume preserve volumes; PostgreSQL restart/API process crash preserve committed
data and revocation history. Full evidence/limitations are in the external report.

Containment of public ingress is distinct from stopping an active runtime. First
request Stop and prove STOP_CONFIRMED/released reservations using the existing
controller; do not infer physical Stop from stopping Nginx. For gateway-only
containment with no active jobs, the tested operator sequence stops/removes only
this project's gateway, restores the accepted unavailable edge with
`/etc/oddpath/tls-edge.env` + `/opt/oddpath/deploy/staging-edge.compose.yml`, then
runs `/opt/oddpath/ops/tls-deploy.py apply` and fresh health. Never remove a data
volume, restore an old journal, reset a fence or count a historical GO as release
authorization. A containment/resume marker is history; inspect the actual current
gateway and health before choosing the next action.

The existing global active-browser cap remains1 and daily owner cap remains3.
The three successful UI journeys consumed that allowance. After final mount
rebinding, a fourth UI approval correctly received HTTP429 BROWSER_DAILY_LIMIT,
with still3 jobs/attempts, no added reservation or paid usage. This is quota
protection, not a passed final WSS execution: that repeat remains unverified.
Do not reset/raise the quota or replay an old run to obtain acceptance evidence.
Daily allowance follows00:00UTC; independent acceptance must respect it.

A manual FULL_SYSTEM encrypted checkpoint has been created and authenticated with
the existing full-backup tool. It includes PostgreSQL and both current SQLite
journals, with zero active runtimes/fences. Archives remain under the protected
operator directory on Oracle; offHostCopyVerified=false. Its independent wrapping
keys and synthetic login were copied, with explicit owner approval, to an
owner/SYSTEM-only local handoff outside Git/evidence. This is not automated backup,
off-host archive continuity, a fresh restore drill or recovery authorization.

Remaining gates include independent acceptance of this slice, automatic encrypted
off-host backup and quarantined restoration/current continuity, real application
mail, host-loss/alert delivery, capacity/abuse controls, unaided/mobile/accessibility
UX, legal/operator documents and final release acceptance. R2 remains unenabled;
there is no new paid service or public release authorization.



## 2026-10-28 — renewable TLS edge, before application activation

The exact-name DNS/private-browser slice has bounded review GO in
`C:/Users/hatem/Documents/Codex/oddpath-staging-acceptance-20261027/REVIEW.md`.
The next implementation adds a deliberately unavailable TLS edge, not a public
Oddpath demo. Its current execution receipt and limitations are in
`C:/Users/hatem/Documents/Codex/oddpath-staging-tls-20261028/REPORT.md`.
Independent acceptance of this new slice is required. Phase08 remains
NOT ACCEPTED; Public Release NO_GO.

The owner approved IPv4 TCP80/443 on the existing Oracle machine and a free
Let's Encrypt account without contact email under Subscriber Agreement v1.8.
No account upgrade, new paid service, email send, application admission or
real-user data activation is included. DNS remains DNS only; the origin enforces
its own access controls. The existing SSH rule and all DNS records are preserved.

### Files and operating contract

- `deploy/staging-edge.compose.yml` / `staging-edge.nginx.conf`: pinned non-root,
  read-only Nginx. Loopback bindings by default; the separately approved host
  configuration selects IPv4 public80/443. HTTP serves only exact HTTP01 tokens;
  other paths are404 and unknown hosts are dropped. HTTPS app/API/viewer paths
  are503. `/healthz` confirms only the TLS edge, not API/browser readiness.
- `deploy/staging-acme-bootstrap.nginx.conf`: temporary HTTP01-only bootstrap,
  removed before starting the permanent TLS edge. No self-signed certificate is
  exposed as trusted and no browser security warning is bypassed.
- `ops/tls-deploy.py`: Linux/Python3/OpenSSL/Docker deploy hook, root-operated.
  It validates key pairing, chain trust, each configured hostname and at least
  seven remaining days; copies a private immutable generation; atomically
  switches the mounted directory; tests/reloads Nginx; and checks the certificate
  actually served for all three SNI names with normal CA/hostname validation.
  It never calls a CA, changes firewall policy, or enables an application.
- `deploy/self-hosted.tls-directory.compose.yml`: optional later stack overlay
  removing the gateway's two individual TLS secret mounts and mounting the
  managed directory read-only. It changes no ports, origins or admission gates.
  Existing per-file secret mounts retain old inodes after host-file replacement;
  do not treat a successful renewal alone as proof of a newly served certificate.
- `deploy/oddpath-tls-reconcile.{service,timer}`: reconcile after boot and every
  twelve hours. Certbot separately checks renewal through its normal timer and
  runs the deploy hook after renewal. Health requires current served-certificate
  proof; container wget health is liveness only and cannot replace that proof.

Host installation uses root-owned files under `/opt/oddpath/{ops,deploy}`,
`/etc/oddpath/tls.json`, `/etc/oddpath/tls-edge.env`, `/etc/oddpath/tls/`,
`/var/lib/oddpath/acme/` and `/etc/letsencrypt/`. The ACME account/private keys stay
on the host outside Git/evidence exports. Ingress alone reads its0600 UID101 TLS
key. No API/database/browser container, Docker socket or application credentials
are mounted into the TLS edge. Future full-stack activation must preserve its
separate backup, application-auth, WSS, recovery, resource and release gates.

`tls.json` contains exactly `directory`, `lineage`, `container`, `hosts`, `port`
and `caFile`. Live lineage is `/etc/letsencrypt/live/oddpath-staging`; trust store
is `/etc/ssl/certs/ca-certificates.crt`; hosts are the three staging names; port443;
container `oddpath-staging-tls-edge`. Configuration and parent directories must
be root-owned and not writable by other users. Do not publish credentials or
resolved application Compose output when inspecting later stack configurations.

### Renewal, failure and recovery

`python3 /opt/oddpath/ops/tls-deploy.py stage` is initial bootstrap only. It records
STAGED/unhealthy, never success. Start the edge and run `apply` to confirm actual
TLS. The root-owned Certbot deploy hook runs `apply` for this exact lineage;
`RENEWED_LINEAGE` for another certificate is rejected. Prove challenge automation
with `certbot renew --cert-name oddpath-staging --dry-run --run-deploy-hooks
--no-random-sleep-on-renew`, retaining the command result. A dry-run verifies the
test-CA challenge and hook using the active production lineage; it does not
replace the production certificate with a staging certificate.

Use `python3 /opt/oddpath/ops/tls-deploy.py health` for a fresh CA/hostname/expiry
and served-fingerprint check. Exclusive deploy/shared health locks prevent
overlapping publication. RUNNING/STAGED/FAIL, a lost process, unavailable gateway,
or mismatched served fingerprint is unhealthy. An old success cannot clear a
failed deployment. A new process reruns `apply` to reconcile interrupted changes;
only confirmed serving clears failure. A failed post-switch reload attempts to
restore/reload the previous generation, but retains FAIL even when rollback
works. Inspect failures; never edit status.json to make health pass. Successful
deployments keep current plus previous generations and prune older owned ones.

For containment, stop this named edge (`docker compose --env-file
/etc/oddpath/tls-edge.env -f /opt/oddpath/deploy/staging-edge.compose.yml stop`)
and disable `oddpath-tls-reconcile.timer` until recovery. The service is not an
application/data restore path. Do not restore an old database, grants, sessions
or browser journal to fix TLS. Preserve certificate/account keys; no destructive
prune/volume reset is part of this procedure. Recheck intended ingress and trust
before restarting. No external alert delivery or host-loss continuity is claimed
by a timer or a successful local health command alone.

Native test command (isolated Linux Docker operator, synthetic data only):
`sudo env ODDPATH_TLS_TEST_DIRECTORY=/absolute/new-disposable-directory
ODDPATH_TLS_TOOL=/absolute/checkout/ops/tls-deploy.py python3
/absolute/checkout/ops/tests/tls-deploy.integration.py`.
Never target an existing directory or production certificate lineage.

Public application/demo acceptance, actual443 authenticated UI/WSS, automatic
off-host backup/restore (R2 Standard free allowance is a candidate), application
mail, full-host-loss recovery and UX/legal/final release gates remain separate.
No claim that Phase08 is complete follows from HTTPS provisioning.


## 2026-10-27 — staging DNS and native embedded-resource rehearsal

2026-10-27: staging DNS and exact-name native rehearsal are implemented, pending
independent acceptance. The owner authorized three DNS-only A records pointing
to the existing Oracle VM: staging-oddpath.eluthira.com,
api-staging-oddpath.eluthira.com and browser-staging-oddpath.eluthira.com. All13
prior records are preserved. Native ARM tests cover production closed admission,
real PostgreSQL/QA/Chrome/noVNC/WSS, Stop/restart, and the embedded Browser/Sources
resource tabs. Report: C:/Users/hatem/Documents/Codex/oddpath-closed-staging-20261027/REPORT.md.
The private rehearsal uses port8443 and a test certificate; the separately built
public-origin image has not been accepted as a deployed public service. Oracle
ingress still permits SSH/ICMP only. Public80/443, trusted certificate issuance
and renewal, persistent closed staging and application mail journeys remain
pending. The live-mail provider slice has bounded review GO in
C:/Users/hatem/Documents/Codex/oddpath-live-mail-acceptance-20261027/REVIEW.md.
Resources are session-scoped; restoring tab layout after leaving/reloading a
conversation remains a UX gap, not an implemented Codex-equivalent guarantee.
No paid service or additional email was enabled. Phase08 NOT ACCEPTED; Public Release NO_GO.


## 2026-10-27 — live mail configured; independent acceptance pending

Closed current-source activation/requarantine now has independent bounded GO:
C:/Users/hatem/Documents/Codex/oddpath-requarantine-acceptance-20261027/REVIEW.md.
The operator implementation checkpoint below retains its dated history.

With the owner's explicit DNS authorization, four additive Cloudflare records
authenticated eluthira.com in Brevo: one verification TXT, two DNS-only DKIM
CNAMEs and one monitoring DMARC TXT with aggregate reports addressed to Brevo.
All nine existing DNS records, including Porkbun MX/SPF, remain unchanged.
Oddpath by Eluthira <no-reply@eluthira.com> is a verified sender. The owner created
the SMTP credential; it is stored privately outside Git. One invocation of the
reviewed operations SMTP test on Oracle used mandatory authenticated STARTTLS
and certificate validation. Brevo accepted it, and the owner confirmed Inbox
receipt. The temporary remote key copy and one-shot container were removed.

Report/receipts: C:/Users/hatem/Documents/Codex/oddpath-live-mail-20261027/REPORT.md.
This provider-configuration slice awaits independent review. It does not prove
deployed API email/outbox/verification/reset behavior. No persistent application,
public registration, staging listener, web DNS record, R2 or Render service was
enabled. Next: bounded mail acceptance, then separately authorized closed staging
origin/certificate/HTTPS/WSS and application journeys. Permanent automated
off-host continuity, complete host-loss recovery, private assets/saved-state
activation and remaining UX/legal/release gates stay open. Budget remains no new
financial commitment; Sentry is deferred. Phase08 NOT ACCEPTED; Public Release NO_GO.


## 2026-10-27 — closed current-source activation, pending independent review

Current-source staging now has independent bounded GO:
C:/Users/hatem/Documents/Codex/oddpath-current-source-acceptance-20261026/REVIEW.md.
The new operator implementation is in ops/recovery-activation.mjs and
ops/recovery-runtime-proof.mjs, using the same current-source local/PG ownership.
This first activation supports the existing account-limited production profile:
managed v2/manual login, disabled registration/AI/embeddings/generation workers,
saved login/private assets/imports. No public activation is authorized.

Stage with the existing stage-current command first. Keep the original source
frozen. Drain every application/worker container, retain a stopped supervisor
container and its CURRENT runtime journal volume, and use the same PG16 host.
The activation operator inspects the live local Docker Engine via its Unix
socket; only its own container and PostgreSQL may remain running. Runtime
containers/networks, active/unreported rows, pending failure reports or unsettled
allocationOwner fences block activation. It never clears or replaces a journal.
The operator's /recovery-runtime mount must be READ ONLY and match the actual
stopped supervisor's named volume at /var/lib/oddpath. A written proof JSON or a
historical SQLite export is not accepted. Run as the journal's native file owner,
with private credentials/state, read-only root filesystem, dropped capabilities,
no-new-privileges and private tmpfs. A quiesced checkpointed journal is inspected
through a private bounded copy; any nonempty WAL blocks rather than being omitted.
Both journal bytes/identity and the live container drain are rechecked. Do not
kill a creator and infer settlement from resource absence.

Only this trusted one-off operator receives the Docker socket and administrative
PG credentials. API, browser and tenant processes never receive them. The new
CLI only reads the Docker API. No permanent service or deployment is added.
Additional private environment, alongside the existing PG/state settings:

    ODDPATH_RECOVERY_ACTIVATION_ACK=CURRENT_SOURCE_CLOSED_ONLY
    ODDPATH_RECOVERY_POSTGRES_CONTAINER=<exact-local-PG-container>
    ODDPATH_RECOVERY_SUPERVISOR_CONTAINER=<exact-stopped-supervisor>

    node ops/recovery.mjs activate-current-closed --confirm-source oddpath --operational-name oddpath_recovered_<unique> --runtime-role oddpath_runtime
    node ops/recovery.mjs requarantine-current-closed --confirm-database oddpath_recovered_<unique>

The runtime role must be an existing standalone LOGIN role without elevated
attributes, group/SET ROLE membership, owner authority or other ordinary members.
No roles or migrations are created. The preparation connects administratively
while the target remains marked and exclusive. Unknown/reserved/pending usage,
unapplied receipts, unconfirmed attempts, browser holds/Stop, queued/running QA,
pending generation, any saved state or private-asset row block this first scope.
Resolve applicable work through the existing source services BEFORE staging;
this command never reconciles money, guesses consumption or calls a provider.
Refusal preserves usage/holds. Web sessions are invalidated on the target only,
after all preparation checks pass. No user/account/quota data is erased.

The prepared target is closed again; live source, ownership, journal and drain
proofs are checked before one PostgreSQL transaction renames it to a distinct
operational name, writes ODDPATH_RECOVERY_CLOSED_ACTIVE_V1:<operation>, grants
CONNECT only to the safe runtime role and opens it. The original stays frozen.
Normal API and routine API-job startup enforce the existing closed production
profile for that marker, even after restart; ordinary/public mode is rejected.
Historical/future-unknown quarantine markers and restore names remain rejected.
Operational backups can recognize an explicitly activated closed database.

Activation intent is persisted before preparation. Lost replies are recovered
from live cluster/OIDs/markers, not an old JSON or provider replay. An interrupted
private preparation can be closed and retried. cancel-current may resume the
source only before activation, with the exact old closed target still present
and the operational name absent. A committed or uncertain rename cannot reopen
the source through cancel. Requarantine requires a fresh drain, closes/marks the
activated target and revokes its CONNECT grant atomically; it retains all data
and does not reopen the old source. It is a safe stop, not rollback to stale data.
A requarantined operation cannot automatically reactivate.

Requarantine first commits the admission fence, quarantine marker and CONNECT
revocation. It then checks fresh PostgreSQL sessions AND prepared transactions
outside that transaction. Any survivor returns RECOVERY_TARGET_NOT_QUIESCENT;
the database stays closed and the journal stays REQUARANTINE_INTENT. The tool
never kills a session or resolves a prepared transaction on the operator's behalf.
Explicitly drain existing clients and resolve applicable prepared work through
trusted administration before retrying. A previously completed record is also
revalidated and becomes incomplete if live work remains. Only a fresh zero/zero
check permits CURRENT_SOURCE_REQUARANTINED. Source closure is preserved through
failures, lost replies and restart. The 2026-10-27 P2 correction and regression
evidence await independent acceptance in
C:/Users/hatem/Documents/Codex/oddpath-requarantine-fix-20261027/REPORT.md.

Results are confined to closed activation; releaseAuthorized remains false.
Physical Stop proof is explicitly dated at activation, not claimed as live state
forever. This does not supply full host-loss recovery, current vault/objects
promotion, unresolved-cost adjudication, automatic off-host backup or public
service/UX/legal acceptance. Phase08 NOT ACCEPTED; Public Release NO_GO.
The operational name shares staging's advisory-lock namespace, including on
retry/cancel/requarantine, so another recovery operation cannot change its fences
between inspection and commit. The new real-PG held-name-lock regression failed
before this fix and passes afterward.

The maintained Linux/Python3/Docker test is ops/tests/recovery-activation.integration.py,
with two test-only fixtures under ops/tests/fixtures. It refuses an existing
container/volume workload before entering cleanup, requires already reviewed
local images plus a private images.json (images.runtime and images.operations),
and uses new random resource names and owned synthetic databases only:

    ODDPATH_RECOVERY_ACTIVATION_TESTS=1 python3 ops/tests/recovery-activation.integration.py --task-dir /private/synthetic-recovery-test --output-name run1

It is an explicit isolated rehearsal, not an automatic production/CI action.
Implementation and failed-test evidence: C:/Users/hatem/Documents/Codex/oddpath-closed-recovery-activation-20261027/REPORT.md.


## 2026-10-26 — current available-source recovery staging, pending acceptance

The preceding manual off-host/quarantined-restore/native-reboot rehearsal has
bounded independent GO in
`C:/Users/hatem/Documents/Codex/oddpath-continuity-acceptance-20261026/REVIEW.md`.
This next slice supplies current relational continuity when the original source
is still available, on the **same PostgreSQL16 cluster**. It is not a host-loss
fallback, an old-snapshot promotion path or a substitute for full-system backup.

Canonical implementation: `ops/current-source.mjs` through `ops/recovery.mjs`.
Use a separate trusted administrative PG connection to the `postgres` control
database, a private pgpass and a new0700 state directory outside the checkout.
Credentials remain external; never put administrative access in the API, a
worker, browser service, image, command-line DSN or ordinary backup credential.
The existing PG environment/SSL and private-file requirements apply.

Stop admission and drain API, background workers, migrations and external-cost
operations first. The tool checks actual source sessions and prepared transactions
before and after freezing; it never terminates them or resolves prepared work.
It cannot itself certify completion of an external LLM call or physical browser
Stop. Pending receipts, unknown usage and unreleased reservations are preserved.

Provision a dedicated `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE` target-owner
role without replication/BYPASSRLS or any ordinary member/SET ROLE path. The
source owner must differ. Do not precreate the target: its name must be a new
`oddpath_restore_<8–45 lowercase letters/digits/underscores>` database.

With the private control environment loaded:

```sh
export PGDATABASE=postgres
export ODDPATH_RECOVERY_STATE_DIRECTORY=/private/recovery/<new-operation>
export ODDPATH_RECOVERY_SOURCE_ACK=FREEZE_SOURCE_KEEP_TARGET_QUARANTINED
node ops/recovery.mjs stage-current --source oddpath --target oddpath_restore_current_<unique> --owner oddpath_recovery_owner
node ops/recovery.mjs inspect-current
# Explicit cancellation only; this resumes eligibility of the SOURCE alone:
node ops/recovery.mjs cancel-current --confirm-source oddpath
```

The tool atomically sets source `ALLOW_CONNECTIONS=false` and a persistent
`ODDPATH_RECOVERY_SOURCE_FROZEN_V1:<operation>` startup marker. It rechecks that
no source session or prepared transaction remains. PostgreSQL then performs its
exclusive, consistent template copy (`STRATEGY WAL_LOG`). The new target is
created with `ALLOW_CONNECTIONS=false`, PUBLIC access is revoked, and its
quarantine marker contains the operation identity. No copy can be exposed between
CREATE, ACL and marker persistence; even superusers cannot establish a new
connection to a closed database.

Both databases remain closed after success and after any uncertain failure.
There is no automatic source reopen, target overwrite, provider replay, hold
release, guessed charge, migration, application start or promotion. PG advisory
locks serialize source/target operations; a separate local state lock fences
journal publication. New processes validate actual cluster identity, database
OIDs, markers, closure, ACL and owner membership rather than trusting an old
success JSON. Observed changes invalidate staged proof; reconnecting cannot
revive it automatically. Uncertain CREATE acknowledgements retain closed targets.

`cancel-current` requires the exact source confirmation and live identity/fence
checks. It restores the source's exact former comment and connection eligibility
without opening or dropping the target. It is safe to repeat after a lost cancel
acknowledgement. It does not restart services. Historical target inspection by
an administrator is a separate isolated action and never grants activation.

The result is `CURRENT_SOURCE_STAGED_QUARANTINED`, with
`postgresContinuity=CURRENT_QUIESCED_SAME_CLUSTER_COPY`, not a GO. It proves the
committed relational copy at that point while the source stays frozen; it does
not prove unknown provider cost or independent SQLite/object continuity.
`physicalStop` and `revocationContinuity` remain `UNVERIFIED`; activation and
release authorization remain false. The original read-only `assess` contract is
unchanged and still returns `RECOVERY_BLOCKED`, including for empty counters.

Evidence, failed fixture attempts, test commands and source/image correspondence:
`C:/Users/hatem/Documents/Codex/oddpath-current-source-recovery-20261026/REPORT.md`.
Targeted independent acceptance is pending. Permanent automated off-host storage,
complete source-loss continuity, independently current revocations/physical Stop,
reviewed activation and live provider/UX/legal gates remain open. Cloudflare,
Brevo and Sentry stay deferred. **Phase08 NOT ACCEPTED; Public Release NO_GO.**


## 2026-10-26 — Oracle continuity rehearsal, pending independent acceptance

Manual encrypted off-host roundtrip and quarantined restore passed36 native
integration checks; real host reboot/recovery passed23 checks; Linux ARM64
operations regression passed62 tests. Evidence, failed setup attempts and
limits: `C:/Users/hatem/Documents/Codex/oddpath-oracle-continuity-20261026/REPORT.md`.
Credits/unknown usage and an unexpired synthetic chat usage hold survived;
current revocations/quarantine/creator fences remained enforced. Backup health
stayed failed across reboot until a new verified backup succeeded. All owned
test containers/volumes were removed. Production code was not changed.

This is temporary manual off-host evidence, not unattended backup, continuous
post-snapshot financial/deletion recovery, live promotion, or a new live-browser
host-crash proof. Those gates remain open. Cloudflare and Brevo setup are
deferred by the owner; Sentry remains deferred. Next: targeted independent
review of this bounded slice. **Phase08 NOT ACCEPTED; Public Release NO_GO.**


## 2026-10-26 — bounded activation accepted; live services preparation

Independent acceptance: **GO_BOUNDED_CLOSED_PRODUCTION_BROWSER_ACTIVATION**,
retained in `C:/Users/hatem/Documents/Codex/oddpath-closed-acceptance-20261026/REVIEW.md`.
This accepts exact allowlisted accounts under production validation, with
managed browser execution, quotas, TEXT evidence and confirmed Stop. The
90 affected/new unit checks, ten new real HTTP/PostgreSQL cases and 36 native
Oracle checks passed; the latter include the aggregate HTTP assertion.
Earlier dated pending-review entries below retain their historical scope.

The owner authorized preparation of Cloudflare/Brevo with existing Oracle.
Read-only preflight confirmed Cloudflare nameservers, existing Porkbun MX/SPF
and current HTTPS redirects. Oracle reached Brevo587 using verified STARTTLS
and TLS1.3. Authentication/inbox delivery were not attempted; account dashboards
require owner login. No DNS records, redirect rules, credentials, ingress or
provider resources were changed. No message was sent or Render service created.
Evidence and non-deployable staging templates are retained locally in
`C:/Users/hatem/Documents/Codex/oddpath-live-services-20261026/`.

Next: inspect the existing provider accounts, review exact DNS/sender records,
then validate authenticated mail and closed staging HTTPS/WSS/cookie/IP behavior.
Preserve the existing receiving MX/SPF and single trusted proxy hop; DNS-only
origin access requires its own trusted certificate. Rebuild web for exact
staging API/viewer origins. Missing credentials intentionally prevent startup.
Off-host continuity, real target onboarding, UX/legal and release gates remain
open. **Phase08 NOT ACCEPTED; Public Release NO_GO. Sentry remains deferred.**


## 2026-10-26 — closed production activation, pending independent review

The optional self-hosted.closed-browser.compose.yml overlay implements an exact
account-limited managed-browser rehearsal under NODE_ENV=production. Its canonical
contract and remaining exclusions are in apps/browser-runtime/README.md. This is
an explicit closed exception to the default v2 rejection; public v2/private-asset
activation remains blocked. Existing controllers, quotas, immutable approval,
confirmed Stop, key separation and physical recovery are reused. Real UI approval,
Chrome/noVNC HTTPS/WSS, completion, Stop and process-crash recovery were rehearsed
on the existing Oracle host with synthetic data and no paid provider calls.
Independent acceptance is pending; Phase08/Public Release remain unaccepted.
The dated inventory entries below retain their original scopes and decisions.


## 2026-10-24 — recovery fence and assessment, pending independent acceptance

Local notifications received targeted GO in
`work/phase-08a-alerts-fix-acceptance-20261023/REVIEW.md`. The next authorized local
slice makes quarantine enforceable at the normal API/job entry points. Both
official restore paths stamp a persistent database-level marker before importing
tables. API startup and routine reconciliation/cleanup/reaper/transition commands
refuse marked databases and legacy `oddpath_restore_` names. The marker survives
rename/restart; runtime roles cannot remove it. No new Prisma migration, grant,
activation flag or promotion command is supplied.

`node ops/recovery.mjs assess` inventories a quarantined DB read-only and exits2
with `RECOVERY_BLOCKED`, even for zero pending rows. Snapshot counts are historical
facts, not proof of financial/deletion/revocation continuity or physical Stop.
Evidence and remaining gates:
`work/phase-08a-recovery-fence-20261024/IMPLEMENTATION_REPORT.md`.

Post-snapshot continuity must come from an independently preserved current
quiesced source or verified PostgreSQL WAL/PITR, with separate current revocation
and physical-runtime proof. No custom financial journal, replication service or
cloud storage was added. No such independent source exists in the tested local
backup alone; total-host-loss promotion stays blocked. Actual off-host/PITR
operation, deletion reconciliation, saved-login invalidation/consent, promotion
and release require separate evidence and acceptance. Do not remove a marker,
rename a legacy unmarked restore or use test flags to bypass this boundary.

## 2026-10-23 — basic operational email, locally accepted 2026-10-24

The full-data backup/quarantined recovery slice received bounded local GO in
`work/phase-08a-full-backup-acceptance-20261023/REVIEW.md` (45 integration checks,
44 ops tests; maintained files and previous evidence unchanged). This does not
accept off-host recovery, live promotion, all Phase 08 or Public Release.

The owner authorized basic monitoring without Sentry. The optional
`deploy/self-hosted.alerts.compose.yml` adds one independent status reader and
authenticated STARTTLS email sender. Use
[the configuration contract](../deploy/self-hosted.alerts.env.example).
It reuses `maintenance.mjs` health semantics for the actual maintenance manifest
and selected CLOSED_DATABASE_ONLY/FULL_SYSTEM backup job; optional API readiness
also validates the existing response body. Source status volumes are read-only.
No DB/API/vault/backup credentials, live journals or Docker socket enter this
service. Its private local state/SQLite ownership fence is separate.

Incidents/notices and bounded exponential retry times are persisted before SMTP.
One pending Message-ID survives restart; duplicate messages remain possible after
ambiguous SMTP acceptance or a crash before recording it. Repeated scans dedupe;
at most eight automatic attempts per rolling hour survive flapping/restarts,
including rejected/ambiguous sends (excess notices stay pending/failed health).
Unresolved incidents repeat after six hours. Recovery needs all configured checks
to pass and a recovery notification accepted by SMTP. Neither a previous successful
backup nor an unsent recovery clears failed health. A config identity change
fails closed against existing state instead of silently dropping old notices.
Messages contain fixed check labels/incident IDs/times, never child errors,
application content, URLs, credentials or database connection strings.

This is basic local supervision/delivery, not comprehensive observability or an
external failure domain. It cannot send when the entire host/network is down.
Actual inbox delivery and external host-death monitoring remain mandatory live
gates. Reapers/mail outbox/application error rates, disk capacity and provider
budgets still need their separately selected operational coverage. This slice
does not claim those are monitored by its three checks. Sentry/APM is deferred.
No external recipient or provider was contacted by the synthetic local tests.

Implementation and validation evidence are kept in ignored
`work/phase-08a-alerts-20261023/IMPLEMENTATION_REPORT.md`. R1/R2 were fixed and
targeted local acceptance is GO in the 2026-10-24 review linked above. Production guards remain closed; no service
purchase, cloud provisioning, deployment or public release is authorized.

The dated sections below retain their original implementation/review checkpoints.

## 2026-10-23 — full-data backup slice, implementation pending acceptance

The local integrated stack received bounded acceptance in ignored
`work/phase-08a-stack-acceptance-20261023/REVIEW.md`; this does not accept all
Phase 08. The owner then authorized the full-data backup/recovery slice, with no
hosting spend. Read `deploy/self-hosted.full-backup.env.example` and
`BROWSER_VAULT_OPERATIONS.md` for its current operational contract.

The optional fourth overlay provides native-owner SQLite exporters over private
Unix sockets and the existing backup supervisor's separate FULL_SYSTEM job.
It captures PG, runtime/vault journals and READY object bytes, plus separately
encrypted key escrow. Daily capture/seven-day retention are local capabilities;
neither an off-host failure domain nor current post-snapshot financial/deletion
continuity follows from a snapshot. Restore always stays isolated/quarantined
and cannot activate old journal authority or release a creator/reservation fence.
All production feature guards stay closed. Source journal modes are retained;
the aggregator has no live-journal mount or Docker socket.

Implementation/testing evidence belongs to ignored
`work/phase-08a-full-backup-20261023/IMPLEMENTATION_REPORT.md`: 32 local Docker/
PostgreSQL integration checks passed with cleanup, including child SIGKILL,
restart, isolated restore and deletion/credit continuity boundaries. Full
`npm run verify` passed (2051 pass, 0 fail, 1 documented Windows skip).
Independent acceptance of this new slice,
off-host transfer, live alerts/R2 recovery, native Oracle ARM/capacity and
production activation remain open. No Phase 08 or Public Release GO is granted.

The earlier dated sections below retain their historical scope and decisions.

## 2026-10-23 — local integrated stack, pending independent acceptance

The local managed-routing/login acceptance blocker is closed by the targeted
CONNECT repair review in ignored
`work/phase-08a-egress-acceptance-20261023/REVIEW.md`. It discloses that the same
conversation participated in implementation; no separate model reviewed it.
This accepts that bounded local mechanism, not G1 production activation or all
Phase 08. Historical reports and their original decisions remain unchanged.

The owner authorized connecting existing components. Use the THREE explicit
files `deploy/self-hosted.compose.yml`, `self-hosted.operations.compose.yml`,
and `self-hosted.stack.compose.yml`, with their private interpolation templates.
The added stack supplies a nonroot standard Nginx TLS/static frontend with exact
app/API/viewer hosts, HTTP and WebSocket proxying, the existing runtime workers,
the API reaper, and external durable vault/runtime journal volumes. Only loopback
HTTPS is published; API/PG/CDP/VNC/control ports remain private. The frontend's
Cloudflare and Nginx headers come from the same existing build policy. Changing
API/viewer hostnames requires rebuilding the frontend; startup rejects mismatch.

The default is CLOSED production. Registration, AI, v2/runtime/manual/saved login,
private assets and imports retain their existing guards. The optional browser
profile does not bypass the production v2 validator. Actual full-browser testing
uses `ODDPATH_STACK_LOCAL_TESTS=1 node ops/tests/local-stack.integration.mjs
--output-dir work/<new-empty-directory>` on uniquely owned synthetic resources.
Its generated NODE_ENV=test override exists only in the ignored evidence folder,
never the maintained deployment. It is not a live deployment recipe.

Private API vault/revocation keys go only to API/API reaper, which share the SAME
durable revocation journal under the API UID. Supervisor/runtime reaper share a
different durable journal and receive transfer keys only. Tenant Chrome receives
neither. Existing maintenance/backup supervisors retain their own private state,
credentials and fail-closed health contracts. Provision volumes and Linux file
ownership explicitly before boot; never reset fences or reuse user-data volumes.

**Unchanged open gates:** encrypted multi-component backup/restore and independently
current revocation/deletion/accounting continuity; off-host copy and live alerts;
production feature activation; native Oracle ARM isolation/capacity; published
DNS/TLS/cookie/WebSocket/mail/R2 proof; operator/legal publication; unassisted UX
and independent release acceptance. The database-only backup CLI deliberately
refuses browser/vault/object data and must not be presented as a full backup.
No purchases, DNS changes, cloud provisioning or deployment are authorized here.
The isolated current-image rehearsal passed 25 checks in ignored
`work/phase-08a-stack-20261023/run13/`, with actual Vue frontend sign-in, strict
fixture-CA TLS, Secure/HttpOnly cookies, CSRF, framebuffer pixels and WebSocket
frames, approved manual QA/PASS/evidence, UI Stop, confirmed-exit reservations,
component restart and retained vault revocation. Existing maintenance commands
completed. The encrypted CLOSED_DATABASE_ONLY snapshot restored to a new
exclusive target as RESTORED_QUARANTINED; after browser data existed the same
backup CLI correctly refused its unsupported scope. All test resources were
removed and original database ID/start/health remained unchanged during that
rehearsal (metadata only). Continuation observed a later start timestamp for the
same healthy original container; its cause is unverified and recorded in the
report. No SQL access to that database was used for this audit.
This was coached synthetic execution, not unaided-user UX or a full system restore.
The responsive dock's existing Review decision action opens manual-login controls;
the test uses that real interaction without forcing DOM/CSS state. Current API,
migrator, operations, supervisor and frontend images were built from their actual
Dockerfiles; old images/evidence remain preserved. Native Linux secret ownership
was tested via private Docker volumes, not certified for an eventual host's files.
Full `npm run verify` passed: 2038 pass, 0 fail, 1 Windows skip covered by the
separate Linux vault test. All 568 previous evidence hashes and nine manifests
match; `git diff --check` passed. Final verification and limits are in
`work/phase-08a-stack-20261023/IMPLEMENTATION_REPORT.md`. Independent review is
required; this implementation is not a Phase 08 acceptance or public release.

## Earlier dated checkpoints

2026-10-18. **Local foundation implementation in review; Phase 08 NOT ACCEPTED.
Public release: NO_GO.** Following the documentation reconciliation, the owner
authorized local Phase 08 implementation with no additional hosting spend.
Their screenshot shows an Oracle account in Frankfurt and no Compute instance;
it does not prove available capacity, ARM isolation, a deployment or free billing.
No cloud resources, DNS, working database or production feature gates were changed.

Phase 07 has bounded acceptance GO: [PHASE_07_CLOSEOUT.md](PHASE_07_CLOSEOUT.md).
Its local acceptance does not approve the infrastructure or the public beta.

2026-10-20 continuation: the R5 state-publication/lock-loss repair has targeted
independent local acceptance (97 fresh checks; original files/evidence preserved),
recorded in ignored `work/phase-08a-state-ownership-acceptance-20261020/FINAL_REVIEW.md`.
The owner then authorized the bounded 08A.1 automatic project-routing slice.
Its current implementation is local and pending independent acceptance; it does
not remove production activation gates or complete all 08A/08B requirements.
Local routing implementation receipt: [managed-routing evidence](evidence/phase-08a/managed-routing-20261020.json).
The complete 266-case manifest and 24-case Docker suite pass; independent
acceptance of this slice is still pending.

## Which document controls which decision

1. [ODDPATH_BETA_IMPLEMENTATION_PLAN.md](ODDPATH_BETA_IMPLEMENTATION_PLAN.md):
   accepted public verified-email beta, one session/QA controller, limits,
   original EUR 10/month infrastructure ceiling, deferred scope and dependencies.
   The owner's later instruction is stricter: no additional hosting spend now;
   paid provider examples are fallback references, not permission to purchase.
2. This inventory: existing implementations, documentation conflicts and the
   bounded sequence for Phase 08. It does not waive any operational gate.
3. [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md): operational requirements,
   safe migrations, smoke, backup/restore, rollback and release gates. Current
   policy updates take precedence over dated provider/private-beta examples.
4. Feature closeouts and evidence: what actually passed locally, on which date
   and within which limits. Historical counts are not fresh release receipts.
5. Provider runbooks/Blueprints: reusable deployment examples, conditional on
   final topology, current prices, capacity and operator approval. The old
   Render selection is not evidence of compliance with the later budget or
   managed-browser requirements. No provider price/availability was verified
   in this documentation-only task.

## Current implementation slice — local, closed, pending independent review

- `deploy/Dockerfile.api` builds separate nonroot API runtime and migration
  images, with OpenSSL installed for Prisma. The runtime excludes development
  dependencies and the Prisma migration CLI; API boot never runs migrations.
- `deploy/self-hosted.compose.yml` and `deploy/self-hosted.env.example` provide
  an opt-in, closed API/private PostgreSQL rehearsal. Database storage is an
  explicitly provisioned external volume; PostgreSQL has no published port.
  The API binds only host loopback, with read-only filesystem, bounded resources
  and no Docker socket. Separate schema-owner and DML-only credentials are
  mandatory. Bootstrap and grants are explicit operator actions, never hidden
  startup migrations. Missing configuration fails instead of using defaults.
- The existing browser and supervisor Dockerfiles now select verified `amd64`
  or `arm64` package repositories using BuildKit `TARGETARCH`. Security and
  execution code are unchanged. Cross-platform component checks are preliminary;
  native Oracle Chrome sandbox, isolation and combined API/browser capacity
  still need an actual ARM host. One-browser limits have not been raised.
- `npm run test:release:local -- --output-dir work/<new-run>` requires
  `ODDPATH_RELEASE_LOCAL_TESTS=1`, the supported Node version, installed development
  dependencies, local Linux Docker and a cached `postgres:16` image. It creates
  its own labeled, loopback-only PostgreSQL container and fresh databases for
  17 sequential regression suites (15 prior suites plus managed routing and its
  authentication/failure-recovery regressions), including HTTP, local SMTP and
  old-to-new schema upgrades. It neither loads local dotenv credentials nor
  accepts skipped/missing test coverage. Command receipts and before/after
  maintained-input hashes bind the result to the tested Working Tree; changed
  inputs fail the gate. Cleanup verifies exact resource ownership. This is
  `PASS_LOCAL_SUITES`, never a Phase acceptance or release authorization.
- CI now invokes that manifest in place of the two narrower database steps;
  its existing audit, migration parity, verify and build gates remain. Explicit
  sanitized receipts/logs are retained as a one-day artifact on success/failure;
  private `work/` content is not uploaded wholesale. Hosted upload is not locally
  certified. The
  opt-in Render retention example is hourly, matching the current auth contract;
  no scheduler or paid service was activated.

Sanitized validation summary: [local foundation evidence](evidence/phase-08a/local-foundation.json).
Detailed generated logs stay in ignored `work/phase-08a-implementation-20261018/`.
No new Markdown document or documentation restructuring was introduced.
2026-10-18 implementation checks: 256/256 database-manifest tests; 45/45 closed deployment
assertions with 34 real migrations; builds and production dependency audit pass.
The full verify run has one existing Windows-only journal test skip; its
unchanged five-test suite passes inside Linux, including that assertion. These
results are local implementation evidence awaiting independent review.

2026-10-19 continuation: the previously blocked closed Compose rehearsal now
completed with its original fixture unchanged: all 45 original assertions plus
the eight pending A5–A12 checks passed (53/53), including 34 migrations, runtime
role restrictions, HTTP/CSRF, API/PG restart, outage 503 and subsequent recovery.
The same cached runtime/migration image IDs matched a fresh current build across
412 emitted JavaScript files each, normalizing CRLF to LF only. Three additional
checks exercised current child cancellation, timeout and pre-abort behavior on
real Linux with no network or Docker socket. All owned resources and synthetic
credential files were removed; the existing working database was not restarted.
See the [sanitized continuation receipt](evidence/phase-08a/compose-rehearsal-20261019.json).
This completes execution of the pending local rehearsal; independent acceptance
of this slice and Phase 08 remain open. The old creation timeout did not recur
in the unchanged Compose run. A separate Windows directory-bind fixture stalled
before its assertions; its exact source passed via stdin/tmpfs instead. The host
bind intermittency is retained as an unresolved environment limitation, without
changing Compose, extending its old timeout or claiming a production fix.

**Remaining gates:** G1/G2 public activation/routing; full G3 browser/vault/proxy
topology; G4 maintenance supervision, alerts and encrypted off-host restore;
native ARM sandbox/capacity; real TLS/cookies/WebSocket/SMTP/storage; operator
privacy/legal publication; independent acceptance. A persistent-volume restart
is not backup/restore, and a daily DB dump alone cannot recover later missing
usage receipts. Preserve independent revocations and fail closed on uncertain
accounting. The new Compose intentionally does not present itself as that full
production topology or enable the accepted public-beta feature set.

### 2026-10-19 — local operations and database recovery implementation

The next bounded slice adds `ops/maintenance.mjs`, `ops/backup.mjs`, the
`operations` target in `deploy/Dockerfile.api`, and the explicitly selected
`deploy/self-hosted.operations.compose.yml` overlay. Implementation/test receipts
are recorded below after verification; independent acceptance remains required.
This does not activate browser, assets, registration, AI or public release.

The maintenance service inherits the **same closed API environment**, including
quota windows and retention settings. It runs existing compiled commands only:
usage reconciliation every minute, retention every fifteen minutes, and object
deletion every five minutes when all four R2 settings exist. Deletion continues
when uploads are disabled; partial storage configuration fails startup. Mail
outbox supervision remains in the existing API lifecycle. API/browser reapers
are not started by this closed overlay; keep the full browser topology gate open.

Policy rollout is an operator gate: pause maintenance and finish its active
command before changing quota/retention settings, then recreate API and
maintenance from the same reviewed environment before resuming. Do not let an
old cleanup process run beside an API using a newly extended window. Already
purged history cannot be reconstructed by changing configuration; it is not
verified zero. This slice does not add distributed configuration-version fencing.

A PostgreSQL session advisory lock excludes duplicate maintenance supervisors.
Losing that connection stops/awaits the active owned child, records failure and
exits; Compose can restart it. Individual failed/incomplete jobs are retried on
the next bounded maintenance pass. No provider generation command is scheduled.
Job results, last success, heartbeat and a bounded 200-event status-only alert
history persist atomically in a private external volume. Health is nonzero for
failed, incomplete or stale work; exit zero without a recognized completion
record is insufficient. Health becoming unhealthy does not itself cause Docker
to restart a container: an operator/monitor must observe it. No email/webhook or
external alert delivery is implemented or certified by these local alerts.

The backup supervisor has a local SQLite **OS lock**, not a time-expiring lease,
on its private local state volume. Process death releases the lock; a second
holder cannot overwrite the live heartbeat. Use a local filesystem, never NFS
or manual live replacement of lock/state files. Hourly archive retention runs
independently of the source database, encryption key and backup success, so a
database/key outage does not silently extend the seven-day backup policy.
Archive pruning also uses its own `.retention-lock.sqlite` metadata file to
serialize manual/concurrent passes; it contains no application or key data.

The explicit role/volume/key prerequisites are appended to
`deploy/self-hosted.env.example`. Build the same reviewed revision with:

```sh
docker build --target operations -f deploy/Dockerfile.api -t oddpath-operations:reviewed .
```

Use **both** Compose files and the external private interpolation file. After
the existing PostgreSQL bootstrap/migration/grant steps, select `--profile
maintenance` and/or `--profile backup` and start the corresponding services.
The overlay is opt-in; the original closed Compose remains usable alone.
Pre-provision the named volumes with mode0700 and the exact image postgres UID.
File-backed Compose secrets need correct host ownership/mode0600; Compose does
not repair host-file permissions. Runtime/maintenance get DML credentials;
backup gets a distinct SELECT-only role, private pgpass and an independent
32-byte encryption key, without API, migration, SMTP or provider credentials.
The operations image has no Docker socket or public binding and uses a readonly
root, limited resources, dropped capabilities and private temporary storage.

`node ops/backup.mjs create` streams a consistent PG16 custom dump directly into
AES-256-GCM authenticated encryption. The snapshot export and scope check share
one read-only transaction. Header/version/time/identity are authenticated; a
unique archive is published without overwriting earlier ones, authenticated in
full, checked with `pg_restore --list`, and recorded with SHA-256. Encryption
keys must be escrowed separately; archives alone cannot recover a lost key.
Linux file/directory fsync protects publication/status updates, subject to the
selected host/filesystem's actual durability guarantees. Daily scheduling and
seven-day retention are local capabilities, **not proof of an off-host copy**.
The envelope is bounded at5GiB; the overlay's256MiB private verification tmpfs
can impose a smaller real archive limit. Measure sizing/disk pressure before
live data; an oversized/failed verification must stay failed, not skip checks.

This initial backup scope is `CLOSED_DATABASE_ONLY`. It refuses saved-login,
browser-runtime or object records and active browser execution; it must not be
used as a substitute for the full journal/key/object recovery contract in
`BROWSER_VAULT_OPERATIONS.md`. Browser activation requires extending and reviewing
that complete topology. PostgreSQL snapshots retain receipts, unknown usage and
active reservations without guessing final debits or releasing holds.

Recovery is an explicit operator action, never a startup migration. Use a
new isolated PostgreSQL database named `oddpath_restore_<8–45 lowercase
letters/digits/underscores>`, a separate recovery credential owning only that
target, and `ODDPATH_RESTORE_ACK=ISOLATED_EMPTY_TARGET`. With its PG connection,
private pgpass, archive directory and independently retained key configured:

```sh
node ops/backup.mjs verify /private/archives/<archive>.opb
node ops/backup.mjs restore /private/archives/<archive>.opb --confirm-target oddpath_restore_<unique_id>
```

Authentication completes in private temporary storage before any target
connection. A populated target or other connected client is refused. Restore
also requires that the recovery credential owns the target and that CONNECT is
not granted to PUBLIC or any other role. Pre-provision it with `REVOKE ALL ON
DATABASE <target> FROM PUBLIC`; do not grant application access automatically.
The recovery owner must not be granted to any ordinary role, directly or through
groups. The guard checks effective CONNECT and rejects all non-superuser owner
memberships, including NOINHERIT, SET-only and mixed SET/INHERIT chains. This is
an intentionally exclusive recovery-role contract; PostgreSQL superusers remain
trusted administrators. Coordinate role/ACL changes with the recovery operator.
This keeps the restored data inaccessible to ordinary application roles until
the operator explicitly completes the recovery gates and grants access. Restore
uses `--exit-on-error --single-transaction --no-owner --no-acl` without `--clean`,
does not create/drop databases, and never starts an application. Failed
restoration rolls back; a lost acknowledgement requires inspection rather than
blind overwrite/retry. Temporary plaintext is removed in cleanup (container
tmpfs disappears on termination); no plaintext dump is retained with archives.
Any unsuccessful supervised backup creation now terminates the daemon, including
SIGKILL results, ordinary nonzero exits and execution errors. The Compose
`unless-stopped` policy restarts its container with a fresh private tmpfs; health
stays failed until a new verified backup succeeds. The existing 60-second retry
delay survives restart, and earlier encrypted archives stay intact. Each job
persists `failurePending` separately from its current `outcome`, so starting a
retry or refreshing the heartbeat cannot clear an unresolved failure. Only a
validated successful completion clears it. Older failed records are carried
forward; older RUNNING records without the new distinction remain unhealthy
until a fresh success. Normal scheduled attempts with a known recent success
and no unresolved failure retain their existing health behavior within the same
owner. After an unclean owner exit, prior RUNNING state (including recent PASS
jobs) remains uncertain until fresh verified completions. Do not run
this daemon under a bare host process restarter that reuses host temporary files:
its abnormal-death cleanup contract requires the reviewed container boundary.

The result is **RESTORED_QUARANTINED**, never a release authorization. The old
snapshot cannot prove post-snapshot consumption, account deletions or revocations.
Keep it closed until independently current trusted accounting/deletion history,
physical Stop and vault continuity are established, migrations/grants are
verified and the restored build is smoke-tested. Reconcile committed receipts
idempotently using the existing `usage:reconcile`; never replay the LLM or turn
unknown estimates into confirmed debits. Missing history is an unresolved
recovery gate, not verified zero. Seven-day archive retention still applies to
deleted personal data; recovery must not silently resurrect deleted accounts.

Maintained checks:

```sh
npm run test:ops
# Guarded local Docker/PG rehearsal, NEW output directory and no real data:
ODDPATH_OPS_LOCAL_TESTS=1 npm run test:ops:local -- --output-dir work/<unique-run>
```

The rehearsal needs the reviewed local image tags documented in its fixture.
The operations tag is `oddpath/phase08-operations:state-ownership-fix-20261020`; an
explicit `ODDPATH_OPS_TEST_IMAGE` selects another locally reviewed image. The
previous local image remains available for retained RED evidence.
It refuses remote Docker TCP/SSH contexts, creates only uniquely owned resources
and checks ownership before cleanup. On Windows Docker Desktop, private Linux
test volumes carry key/pgpass files; that is explicit test transport, not proof
of native host file-secret permissions. Native ARM, actual off-host storage,
alert delivery, full browser/journal restore and public deployment stay open.

Historical local verification after the two security repairs: **18/18 operations
tests on Windows and Linux** (same 18 cases), **46/46 real Docker/PostgreSQL/HTTP checks**,
34 migrations and **256/256 prior-phase regressions in 15 suites** on a stable
maintained-input fingerprint. Complete verify passed; its existing Windows
journal skip is covered by the unchanged **5/5 Linux suite**. The earlier
production audit remains historical evidence; dependencies did not change and
no new audit is claimed for these repairs. Diff-check passed. The state-persistence
cleanup regression has retained RED/GREEN evidence; actual volume write failure,
DB outage, concurrent supervisor denial, abrupt backup restart, corrupted
archive, failed dump, unsafe key mode, private empty restore target and repeated
accounting recovery were exercised. All owned rehearsal resources and synthetic
secret files were removed; the working database was not restarted or changed.
The repair regressions retain RED evidence for inherited owner access and abrupt
child death. Direct/transitive/SET-only/mixed membership targets now stay empty;
the real child-only SIGKILL test proved container restart, no orphan plaintext,
failed health before retry, and an intact earlier encrypted archive. That test
did not originally inspect health while the replacement backup was RUNNING;
the subsequent independent review identified that remaining gap.

See [local operations evidence](evidence/phase-08a/local-operations-20261019.json).
That initial 15/38-check record is preserved. The updated
[security repair evidence](evidence/phase-08a/local-operations-security-fixes-20261019.json)
and ignored `work/phase-08a-ops-fix-20261019/` retain the new verification and
reproduction records. **Independent acceptance of the repairs remains pending.**
The subsequent health repair and its RED/GREEN records are retained in
[health repair evidence](evidence/phase-08a/local-operations-health-fix-20261020.json)
and ignored `work/phase-08a-health-fix-20261020/`. It preserves failed health
through a real PostgreSQL lock, restart, fresh heartbeat and second failure,
and restores health only after verified success. Independent acceptance of
this repair remains pending; earlier review decisions and evidence stay intact.
Historical health-repair validation: **21/21 operations cases on each of Windows
and Linux**, **48/48 real Docker/PostgreSQL/HTTP checks** retaining all 46 prior
checks, and two real PostgreSQL retry/recovery scenarios. Full `verify` passed
with its existing Windows vault skip covered by a fresh **5/5 Linux vault run**.
The subsequent independent review confirmed the retry repair but found a
separate startup race: a pre-lock read could replace a newer failure and its
alerts with an older success. The startup-lock repair now loads jobs/alerts
only after acquiring the supervisor lock and before its first write. A lock
loser does not read or replace owner state; an unreadable locked state is
preserved and the lock/client is released. Pending failure, retry timing and
alerts remain authoritative until validated success. Its regression tests and
RED/GREEN CLI/PostgreSQL evidence are retained in ignored
`work/phase-08a-startup-lock-fix-20261020/` and
[startup-lock repair evidence](evidence/phase-08a/local-operations-startup-lock-fix-20261020.json).
Independent acceptance of this narrow repair remains pending.
The subsequent targeted review confirmed the startup ordering repair but
reproduced a PostgreSQL-disconnect race during the asynchronous state read.
The former PG owner could overwrite a successor's failure. The ownership repair
keeps the existing host-local SQLite publication fence for **both** supervisor
roles until all writes and heartbeats drain; maintenance also retains its PG
advisory lock for work. A PG disconnect aborts work and rejects ordinary/queued
publications, including a final pre-rename check. Only a conservative terminal
failure may be recorded while the independent local publication fence is still
held; no successor can yet read or write that state. Interrupted startup before
state initialization publishes nothing. An unclean RUNNING journal is treated
as unresolved on restart. This requires a shared **local** state filesystem,
not NFS or independent state copies across hosts. RED/GREEN and transition tests
are retained in ignored `work/phase-08a-state-ownership-fix-20261020/` and
[ownership repair evidence](evidence/phase-08a/local-operations-state-ownership-fix-20261020.json).
Independent acceptance remains pending; no Phase 08/public-release GO is granted.
Raw attempts and failure diagnoses remain in ignored
`work/phase-08a-operations-20261019/`. This is **local execution evidence pending
independent acceptance**, not Phase 08/public-release GO. No new Markdown file
or documentation restructuring was introduced.

## Reference inventory and reuse

| Existing reference | Keep/use it for | Reconciliation |
| --- | --- | --- |
| `ODDPATH_LAUNCH_PLAN.md` | Original domain/data-flow, operator boundary, storage/privacy requirements | Older Phase 0–6 numbering and invite/provider decision are historical; current phases are in the beta plan. |
| `DEPLOYMENT_CLOUDFLARE_RENDER.md` | Exact frontend/API builds, DNS/cookies/CORS, staging smoke and restore/rollback steps | Conditional Render example; no browser host/proxy/vault deployment supplied. Do not provision it by inference. |
| `PRODUCTION_READINESS.md` | Operational source of truth and release checklists | Correct public scope, backup term, hourly retention, usage deletion and current local acceptance; external gates stay open. |
| `DEPLOY_AUTH_READINESS.md` | SMTP, cookie/CSRF/proxy and deployed auth checklist | Activation requires token + owner-chosen newPassword; public activation is separate from invite compatibility. |
| `PRODUCT_VISION_AND_LAUNCH_PLAN.md` | Product value, unassisted onboarding and one-session design | Browser/resources/readiness are now locally implemented; independent cross-provider review and native mobile are still deferred. |
| `AUTH_ABUSE_OPERATIONS.md` | Shared PostgreSQL admission, encrypted mail outbox, safe activation and deployment drain | Current operational auth contract; actual sender/DNS/HTTPS proof still required. |
| `QUOTA_OPERATIONS.md` | Durable receipts/reconciliation, quota windows, account-deletion anonymization, Stop reservations | 06B has local GO; no new ledger/retry system needed. Use identical quota policy for API and cleanup. |
| `BROWSER_RECOVERY_RUNBOOK.md` | Unsettled Docker mutation recovery, creation fence, physical Stop | Rehearse on selected host; no fake confirmation or automatic fence reset. |
| `BROWSER_VAULT_OPERATIONS.md` | Versioned keys, independent revocation journal, expiry/restore | PostgreSQL-only backups are insufficient; API/reaper share a durable journal; preserve independent current revocations. |
| `apps/browser-runtime/README.md` | Linux amd64, Docker 28+, sandbox, isolated egress, private viewer, config and tests | Retain dated 3A/3B history; local 3B/4/6B acceptance does not provide public project discovery or production activation. |
| `R2_SMOKE_RUNBOOK.md` | Existing conditional-PUT/CORS/checksum/read/delete provider smoke | Reuse compiled smoke; separate real interruption/recovery/latency proof is still needed. |
| `BINARY_ASSET_PORTABILITY.md` and `PHASE_05_CLOSEOUT.md` | Existing bounded binary exports, restore fencing, tombstones and evidence gaps | Reuse them; no arbitrary-size streaming export or live authority on import. |
| `INCIDENT_AND_DATA_REQUEST_RUNBOOK.md` | Incident ownership, export/deletion monitoring, operator/legal records | Keep reviewed legal material; operator identity, selected processors and alert recipients are still external inputs. |
| `NON_FUNCTIONAL_REQUIREMENTS.md`, `ARCHITECTURE.md`, `QA_CONTROL_PLANE.md`, `QA_EXECUTION_HARNESS.md` | Maintainability, ownership and shared QA lifecycle | Preserve one controller, immutable approval and physical Stop; no second execution system. |
| `EMAIL_PROVIDER_REVIEW.md`, `EMAIL_VERIFICATION_REVIEW.md`, `AUTH.md` | Historical SMTP/auth rationale | Use 06C closeout/operations for the latest activation/recovery semantics; no new email provider adapter implied. |
| `AI_HANDOFF.md`, `NEXT_STEPS.md`, phase checkpoints | Navigation and dated evidence | Top current status now points here; earlier pending-phase paragraphs remain dated history. |

The synced ChatGPT `sources/` directory contained no files in this inventory;
it remains read-only. Repository docs/configuration are the reviewed references.

## Existing code and tooling — do not recreate

| Capability | Actual implementation/configuration | Remaining work |
| --- | --- | --- |
| Build/migration/audit gates | Root `package.json`, `.github/workflows/ci.yml`, API deploy/drift scripts | Run on exact release SHA; current audit/hosted CI are not newly proven by this task. |
| Target smoke | `apps/api/src/scripts/smoke-target.ts`; `smoke:read-only` and `smoke:authenticated-mutation`; `ops/smoke.env.example` | Use compiled candidate against the reviewed HTTPS staging target. Mutation needs dedicated synthetic account/interlock. |
| R2 smoke | `smoke:r2`, `apps/api/src/scripts/smoke-r2.ts`, `R2_SMOKE_RUNBOOK.md` | Run against isolated EU staging bucket with explicit interlock; retain sanitized evidence. |
| Retention/object cleanup | `cleanup:retention`, API `assets:cleanup`, `ops/render-cron-services.example.yaml` | The example is now hourly for the auth contract. Select and rehearse the real scheduler and alerts; the example is not active. |
| Accounting recovery | API `usage:reconcile` and receipt/attempt ledger | Supervise bounded passes; no provider replay or guessed charges. |
| Browser drain/reapers | API `browser:transition` / `browser:reaper`, runtime supervisor/reaper, `deploy/browser-runtime.compose.yml` | Host service supervision, durable storage, shutdown/Stop/alert drills. |
| Runtime/viewer | Existing Chrome/egress/supervisor images and viewer gateway | Pin digests, validate host sandbox/egress/HTTPS WebSocket proxy. Compose supplies only trusted supervisor/reaper topology, not the entire site. |
| Backups/rollback | Existing policy/runbooks and isolated review dump/restore fixtures | No general production off-host encrypted backup/scheduler implementation was found in `ops/`, `deploy/` or production scripts. Choose provider tooling or a bounded operator job; review fixtures are not production backup automation. |
| Registration/email | Existing 06C public-mode gates, SMTP/outbox and shared PostgreSQL abuse store | Live DNS/TLS/deliverability, operator legal publication and explicit release acknowledgement. |
| GO/reporting/export | Existing readiness/evidence modules and inert portable history | Use current code. No release-authority or automatic deployment feature is needed for beta. |

## Verified gaps before calling this a deployable public beta

**G1 — Production activation is still blocked in code.**
`apps/api/src/config/env/validate.ts` rejects production `QA_EXECUTION_V2_ENABLED`;
`validation/storage.ts` rejects production `PRIVATE_ASSETS_ENABLED`. Managed
browser/manual/saved login depend on those existing gates. A deployment cannot
enable them simply by setting flags. Define and independently review a bounded
activation change after prerequisite proofs; never bypass with test NODE_ENV,
weaken validation, or silently drop the accepted browser/evidence scope.

**G2 — Automatic routing is implemented locally; public onboarding acceptance remains open.**
The optional `discovery` mode in the existing supervisor replaces manual project
configuration with bounded, authenticated catalog pages. Only verified owners
and current owner-authorized verified targets receive project-scoped bindings;
target-sharded registrations preserve the existing manifest/profile contracts.
The static 1–20-project mode remains compatible. The single-host adapter grants
no execution approval and uses the same QA controller, immutable approval,
quotas, reservations and physical Stop. A limited host status/Stop/exit path
keeps cleanup possible after project-token revocation; it cannot claim or write
QA results. New routing flags default off and production v2 remains rejected.
Review this implementation independently. Public target setup/unaided UX,
owner-driven reconnect/rekey UX, host/TLS proof and activation remain launch
requirements; this local routing slice does not certify them. See the current
configuration/limits in `apps/browser-runtime/README.md` and its implementation
receipt when available. Do not clear revocations to restore connectivity.

**G3 — Full deployment topology/durability is not supplied by the old Blueprint.**
`render.yaml` supplies API + PostgreSQL, with registration/AI/assets closed;
it does not deploy the Docker host, HTTPS viewer proxy, API reaper or durable
API vault/key/revocation storage. The runtime Compose covers supervisor/reaper
and its own journal, not the API vault journal or external encrypted backups.
The selected host must meet Linux/Docker 28+/sandbox/private-control
requirements and fit the combined infrastructure ceiling. No hosting price or
capacity claim is approved yet. Package selection supports amd64/arm64; ARM
production safety/capacity remain unverified. The new closed API/PG Compose is
only a partial foundation and supplies none of the missing browser/vault/proxy
services by implication.

**G4 — Existing operational jobs are not proof of operation.**
Retention, asset deletion, usage reconciliation, API/runtime reapers, mail
outbox and backup verification need a scheduler/supervisor, owner, failure
alerts and recovery receipts. Disabling dispatch is distinct from physical
Stop; preserve control-plane/reaper availability until confirmed termination.

**G5 — Local specialist manifest implemented; live release proof still open.**
The new sequential manifest reuses core and standalone 06B/06C/07 regression,
HTTP/SMTP and upgrade tests without double-running imported suites. CI invokes
it alongside verify, audit, migration/drift and builds. Hosted CI has not been
run by this local task; native Docker/provider/browser/live operation drills
remain separate gates. Do not replace them with local PASS or a weaker smoke.

## Bounded next sequence

| Slice | Scope / affected files | Dependency | Acceptance / verification |
| --- | --- | --- | --- |
| 08A.0 — this reconciliation | Current doc indexes, Phase 07 closeout/evidence pointer, this inventory | Retained Phase 07 acceptance | Reference/hash/link checks; source/config unchanged. Documentation complete, not deployment-ready. |
| 08A.1 — close real product deployment prerequisites | Scoped routing/binding design using existing Runner/QA services; production activation contract in env validation and relevant tests, only when implementing/reviewing those gaps is authorized | G1/G2 assessed; no controller/ledger redesign | New public project reaches an approved immutable recipe on the shared runtime; cross-owner/revoked/deleted/stale binding denied; quota/Stop/legacy drain preserved. Production enablement requires reviewed proof, not a test-environment bypass. |
| 08A.2 — settle operator topology and evidence manifest | Existing deploy/ops/env examples, CI/release manifest, backup/supervision integration as required | G3/G4/G5; selected host, exact origins, durable journals, approved budget | Complete service/cost/data-flow inventory with no additional hosting spend now; domain and LLM/API separate. Prove safe secrets, durability and jobs/alerts. Verify provider prices/capabilities when selecting, before provisioning. Closed packaging/manifest are locally tested; full topology remains open. |
| 08B — real staging rehearsal | Reuse smoke, standalone integration/Docker tests, browser UI, R2/vault/recovery runbooks | Authorized isolated environment; G1–G5 addressed | Same reviewed build across components, HTTPS/cookie/proxy/WebSocket/mail proof, two-account isolation/SSRF/Stop, no replay, quota/restart/accounting, evidence/export/delete/restore, key/journal recovery and measured capacity. No production data. |
| 08C — public release decision | Retain dated release receipts in production gate; rollback/incident/operator record | All mandatory gates + independent acceptance | Unaided first-user journey, current full tests/builds/audit/migrations, daily encrypted off-host 7-day backups and successful restore/rollback, monitored failure/kill switches, reviewed publication requirements. Only a separately authorized decision may enable public release. |

08A.1 remains open. The current implementation completes a bounded portion of
08A.2 (closed packaging, architecture selection and local test manifest), not
the full topology/backup/operations acceptance. Provider steps and public
activation are not authorized by these files. User input is needed when
selecting/provisioning provider resources or publishing operator/legal details;
do not request secret values in chat.

## Conflicts resolved without discarding history

- **Scope:** public verified-email beta supersedes invite-only rollout examples;
  invite remains supported compatibility, not the selected release mode.
- **Acceptance:** phases 06A–06C and 07 are locally reviewed; this does not close
  live SMTP/TLS/storage/runtime/operational checks.
- **Hosting:** historical Render/Cloudflare/Brevo examples are reusable, not a
  new decision to purchase those resources. Product domains/data boundaries are
  retained references; actual provisioning/account ownership was not inspected.
- **Backups:** accepted beta policy is daily encrypted off-host, seven days.
  Include database, runtime journal, independently current vault revocations
  and separately protected keys; do not roll back revocations with PostgreSQL.
- **Deletion/retention:** account identifiers/context are deleted, while finite
  ownerless quota/consumption exposure remains according to the reviewed 06B
  policy. Active global/user/guest/IP windows and unresolved holds must survive
  cleanup. Do not follow old instructions to erase all usage rows.
- **Scheduling:** auth abuse cleanup requires at least hourly retention, assets
  at least every five minutes when enabled, independent reapers continuously;
  backup is daily. An example cron file is not a running scheduler.
- **Deferred:** Android APK upload/Firebase and later iOS, general independent
  review orchestration, extra providers and billing remain after beta. They are
  not prerequisites or implementations authorized by this reconciliation.
