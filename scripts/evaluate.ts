import { promises as fs } from "node:fs";
import path from "node:path";
import { runEvaluation, type EvalMode } from "../src/evaluator.js";

interface ParsedArgs {
  mode: EvalMode;
  casesDir: string;
  reportPath?: string;
  jsonPath?: string;
}

function printHelp(): void {
  console.log(`
Usage: pnpm evaluate:mock [options]

Options:
  --mode <mock|live>   Evaluation mode. Default: mock.
  --cases <dir>        Directory containing JSON fixture files. Default: eval/cases.
  --report <path>      Write the markdown report to a file.
  --json <path>        Write the raw results as JSON to a file.
  --help               Show this help message.

Live mode is intentionally stubbed: it requires explicit opt-in and a valid
JULES_API_KEY because it burns real Jules sessions against the curated fixtures.
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    mode: "mock",
    casesDir: "eval/cases",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "--mode": {
        const value = argv[++i];
        if (value !== "mock" && value !== "live") {
          throw new Error(`Invalid --mode: ${value}. Use 'mock' or 'live'.`);
        }
        args.mode = value;
        break;
      }
      case "--cases":
        args.casesDir = argv[++i] ?? args.casesDir;
        break;
      case "--report":
        args.reportPath = argv[++i];
        break;
      case "--json":
        args.jsonPath = argv[++i];
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const resolvedCasesDir = path.resolve(args.casesDir);
  const result = await runEvaluation({
    mode: args.mode,
    casesDir: resolvedCasesDir,
  });

  console.log(result.markdownReport);

  if (args.reportPath) {
    await fs.writeFile(path.resolve(args.reportPath), result.markdownReport);
    console.log(`\nReport written to ${args.reportPath}`);
  }

  if (args.jsonPath) {
    const serializable = {
      mode: result.mode,
      totals: result.totals,
      caseResults: result.caseResults.map((cr) => ({
        prNumber: cr.case.prNumber,
        owner: cr.case.owner,
        repo: cr.case.repo,
        title: cr.case.title,
        tags: cr.case.tags,
        comparison: cr.comparison,
      })),
    };
    await fs.writeFile(
      path.resolve(args.jsonPath),
      JSON.stringify(serializable, null, 2)
    );
    console.log(`Results written to ${args.jsonPath}`);
  }

  if (result.totals.f1 < 1) {
    process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Evaluation failed: ${message}`);
  process.exit(1);
});
