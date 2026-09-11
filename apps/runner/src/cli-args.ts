export interface RunnerCliArgs {
  allowProduction: boolean;
  configPath: string;
  headed: boolean;
  help: boolean;
  version: boolean;
}

export function parseCliArgs(argv: string[]): RunnerCliArgs {
  const args = argv[0] === "runner" ? argv.slice(1) : [...argv];
  const parsed: RunnerCliArgs = {
    allowProduction: false,
    configPath: "oddpath.runner.json",
    headed: false,
    help: false,
    version: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--allow-production":
        parsed.allowProduction = true;
        break;
      case "--config": {
        const value = args[index + 1];
        if (!value || value.startsWith("--")) {
          throw new Error("--config requires a file path.");
        }
        parsed.configPath = value;
        index += 1;
        break;
      }
      case "--headed":
        parsed.headed = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--version":
      case "-v":
        parsed.version = true;
        break;
      default:
        throw new Error(`Unknown runner argument: ${argument}`);
    }
  }
  return parsed;
}

export const RUNNER_HELP = `Oddpath local Playwright runner

Usage:
  oddpath runner [--config PATH] [--headed] [--allow-production]

Options:
  --config PATH        Read configuration from PATH (default: oddpath.runner.json)
  --headed             Show the configured Playwright browser
  --allow-production   Explicitly allow recipes approved for a PRODUCTION profile
  --help, -h           Show this help
  --version, -v        Show the runner version
`;
