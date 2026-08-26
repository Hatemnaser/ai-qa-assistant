# EU R2 mutation smoke

This opt-in operation verifies the real private EU-jurisdiction R2 path without
touching application assets. It creates one random object under the dedicated
`oddpath-smoke/r2-v1/` prefix, verifies it, and deletes that exact key in a
`finally` path. Cleanup retries transient deletion failures and performs a
second idempotent delete plus absence check.

The operation checks:

- browser CORS preflight for conditional `PUT`;
- a checksum-bound, `If-None-Match: *` presigned upload;
- rejection of an exact replay with `409` or `412`;
- `HEAD` checksum, content length, and content type;
- SDK-bounded range read and presigned full/range reads;
- rejection of the same object URL without its signature; and
- bounded timeouts, exact cleanup, cleanup retry, and idempotent deletion.

It prints only fixed check names, durations, and fixed failure categories. It
never prints endpoints, signed URLs, object keys, credentials, response bodies,
raw provider errors, or stack traces.

## Prerequisites

Use a private staging bucket created with **EU jurisdiction**, not merely an EU
location hint. Disable public `r2.dev` access and scope the token to that bucket.
Set this CORS policy for the exact staging/product origin:

- allowed methods: `GET`, `HEAD`, `PUT`;
- allowed request headers: `Content-Type`, `If-None-Match`,
  `x-amz-checksum-sha256`;
- exposed response header: `ETag`.

Provide all values through a secret manager or temporary process environment;
do not commit them or paste them into documentation/logs:

```text
R2_ENDPOINT=https://<32-hex-account-id>.eu.r2.cloudflarestorage.com
R2_REGION=auto
R2_BUCKET_NAME=<private-staging-bucket>
R2_ACCESS_KEY_ID=<secret>
R2_SECRET_ACCESS_KEY=<secret>
ODDPATH_R2_SMOKE_CORS_ORIGIN=https://<exact-web-origin>
ODDPATH_R2_SMOKE_CONFIRMATION=CREATE_VERIFY_DELETE_ODDPATH_R2_SMOKE_OBJECT
ODDPATH_R2_SMOKE_TIMEOUT_MS=15000
```

The command fails before any network request unless the exact mode,
confirmation, complete credentials, HTTPS CORS origin, and Cloudflare EU R2
endpoint are present.

## Run

Build and run the compiled production entrypoint:

```bash
npm run build:api
npm run smoke:r2
```

For local source execution only:

```bash
npm run smoke:r2:dev
```

A successful event has `event: "r2_smoke"`, `status: "passed"`, and the fixed
check list. Preserve that sanitized CI event as operational evidence. A failed
event names only the failed check and fixed reason; it is safe for CI logs.

If `object_cleanup` fails, use the R2 console to inspect the dedicated
`oddpath-smoke/r2-v1/` prefix and delete only the object created by the failed
run. Never apply a broad delete or lifecycle rule to application prefixes.

This smoke proves the provider behavior it exercises. It does not by itself
prove process-kill/freeze recovery, multi-instance restore fencing, real
PostgreSQL cleanup concurrency, or maximum-scale imports; those production
activation gates remain separate.
