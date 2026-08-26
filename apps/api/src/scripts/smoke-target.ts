import {
  createDeploymentSmokeFailureEvent,
  createDeploymentSmokeSuccessEvent,
  loadDeploymentSmokeCliConfig,
  runAuthenticatedMutationDeploymentSmoke,
  runReadOnlyDeploymentSmoke,
} from "../operations/deployment-smoke/index.js";

async function main() {
  const config = loadDeploymentSmokeCliConfig(process.argv.slice(2));
  const report = config.mode === "read-only"
    ? await runReadOnlyDeploymentSmoke({
        baseUrl: config.baseUrl,
        csrfHeaderName: config.csrfHeaderName,
        timeoutMs: config.timeoutMs,
        ...(config.webOrigin ? { webOrigin: config.webOrigin } : {}),
      })
    : await runAuthenticatedMutationDeploymentSmoke({
        baseUrl: config.baseUrl,
        confirmation: config.mutationConfirmation,
        credentials: config.credentials,
        csrfHeaderName: config.csrfHeaderName,
        timeoutMs: config.timeoutMs,
        webOrigin: config.webOrigin,
      });

  console.log(JSON.stringify(createDeploymentSmokeSuccessEvent(report)));
}

main().catch((error: unknown) => {
  // Deliberately omit target URLs, credentials, cookies, tokens, response
  // bodies, raw provider errors, and stack traces from operator/CI output.
  console.error(JSON.stringify(createDeploymentSmokeFailureEvent(error)));
  process.exitCode = 1;
});
