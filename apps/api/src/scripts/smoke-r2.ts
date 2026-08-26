import {
  createR2SmokeFailureEvent,
  createR2SmokeSuccessEvent,
  createR2SmokeGateway,
  loadR2SmokeCliConfig,
  runR2MutationSmoke,
} from "../operations/r2-smoke/index.js";

async function main() {
  const config = loadR2SmokeCliConfig(process.argv.slice(2));
  const gateway = createR2SmokeGateway({
    accessKeyId: config.accessKeyId,
    bucketName: config.bucketName,
    endpoint: config.endpoint,
    region: config.region,
    secretAccessKey: config.secretAccessKey,
  });
  const report = await runR2MutationSmoke({
    confirmation: config.confirmation,
    corsOrigin: config.corsOrigin,
    gateway,
    timeoutMs: config.timeoutMs,
  });

  console.log(JSON.stringify(createR2SmokeSuccessEvent(report)));
}

main().catch((error: unknown) => {
  // Output is intentionally fixed and never contains R2 credentials,
  // endpoints, signed URLs, object keys, bodies, provider errors, or stacks.
  console.error(JSON.stringify(createR2SmokeFailureEvent(error)));
  process.exitCode = 1;
});
