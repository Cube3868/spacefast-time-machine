import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const git = (...args) =>
  execFileSync("git", args, { windowsHide: true, encoding: "utf8" }).trim();
if (git("status", "--porcelain", "--untracked-files=normal"))
  throw new Error(
    "Commit reviewed changes before deploying. The live app and published source must match.",
  );
const sourceRevision = JSON.parse(
  await readFile("dist/source/revision.json", "utf8"),
);
if (sourceRevision.revision !== git("rev-parse", "HEAD"))
  throw new Error(
    "Build output is stale. Run npm run build successfully before deploying.",
  );
const staging = resolve(".local", `publish-${Date.now()}`);
await mkdir(staging, { recursive: true });
// The official compiler writes generated files into its input directory.
// Stage a fresh copy so repeated publishes cannot include duplicate bundles.
await cp("dist", staging, {
  recursive: true,
  filter: (path) => resolve(path) !== resolve("dist/__spacefast"),
});
const dryRun = process.argv.includes("--dry-run");
const args = [
  "publish",
  staging,
  "--prebuilt",
  "--source-type",
  "direct-upload",
  "--name",
  "Spacefast Time Machine",
  "--json",
  "--wait",
  "--wait-timeout",
  "600",
  ...(dryRun ? ["--dry-run"] : []),
];
const cliEntry =
  process.env.SF_CLI_ENTRY ||
  (process.platform === "win32"
    ? join(process.env.APPDATA, "npm/node_modules/spacefast/dist/cli.js")
    : null);
const child = spawn(
  cliEntry ? process.execPath : "sf",
  cliEntry ? [cliEntry, ...args] : args,
  { windowsHide: true },
);
let output = "",
  errors = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (errors += b));
child.on("exit", async (code) => {
  const scrub = (text) =>
    text
      .replace(/sf[acm]_[A-Za-z0-9_-]+/g, "[redacted]")
      .replace(
        /(claimToken|continuationToken|deviceCode|secret)"\s*:\s*"[^"]+"/g,
        '$1":"[redacted]"',
      );
  if (code) {
    console.error(scrub(errors || output));
    process.exitCode = code || 1;
    return;
  }
  try {
    const data = JSON.parse(output).data;
    if (dryRun) {
      console.log("Spacefast publish preflight passed; no upload attempted.");
      return;
    }
    const receipt = {
      spaceId: data.space?.id,
      liveUrl: data.space?.liveUrl,
      versionId: data.version?.id,
      status: data.version?.status,
      immutableUrl: data.version?.immutableUrl,
      operation: data.operation && {
        id: data.operation.id,
        status: data.operation.status,
      },
      recordedAt: new Date().toISOString(),
    };
    await mkdir("artifacts", { recursive: true });
    await writeFile(
      "artifacts/deployment.json",
      JSON.stringify(receipt, null, 2),
    );
    console.log(JSON.stringify(receipt, null, 2));
  } catch {
    console.error(
      "CLI returned an unexpected receipt. Credentials were not printed.",
    );
    process.exitCode = 1;
  }
});
