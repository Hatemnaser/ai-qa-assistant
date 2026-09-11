#!/usr/bin/env node

import { parseCliArgs, RUNNER_HELP } from "./cli-args.js";
import { loadRunnerConfig, resolveRunnerToken } from "./config.js";
import { OddpathClient } from "./http-client.js";
import { createPlaywrightSessionFactory } from "./playwright-session.js";
import { OddpathRunner, RUNNER_VERSION } from "./runner.js";

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    process.stdout.write(RUNNER_HELP);
    return;
  }
  if (args.version) {
    process.stdout.write(`${RUNNER_VERSION}\n`);
    return;
  }

  const { config, path } = await loadRunnerConfig(args.configPath);
  const client = new OddpathClient({
    serverUrl: config.serverUrl,
    token: resolveRunnerToken(config),
  });
  const createSession = createPlaywrightSessionFactory({
    browser: config.browser.engine,
    headless: args.headed ? false : config.browser.headless,
  });
  const runner = new OddpathRunner({
    allowProduction: args.allowProduction,
    client,
    config,
    createSession,
  });
  const shutdown = new AbortController();
  let signalCount = 0;
  const requestShutdown = (signal: NodeJS.Signals) => {
    signalCount += 1;
    if (signalCount === 1) {
      console.info(`${signal} received; finishing the active execution before shutdown.`);
      shutdown.abort();
      return;
    }
    console.error(`${signal} received again; terminating immediately.`);
    process.exit(130);
  };
  const onSigint = () => requestShutdown("SIGINT");
  const onSigterm = () => requestShutdown("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  console.info(`Loaded Oddpath runner configuration from ${path}.`);
  try {
    await runner.run(shutdown.signal);
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "The Oddpath runner failed.";
  console.error(message);
  process.exitCode = 1;
});
