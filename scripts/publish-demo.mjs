import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderRelease } from "../examples/orbital-studio/render.mjs";
const restoreLab = process.argv.includes("--restore-lab");
const roundTrip = process.argv.includes("--round-trip");
const root = resolve(
  roundTrip
    ? "../spacefast-time-machine-round-trip"
    : restoreLab
      ? "../spacefast-time-machine-restore-lab"
      : "../spacefast-time-machine-lab",
);
await mkdir(root, { recursive: true });
const cli = join(process.env.APPDATA, "npm/node_modules/spacefast/dist/cli.js");
function sf(args) {
  try {
    return JSON.parse(
      execFileSync(process.execPath, [cli, ...args, "--json"], {
        cwd: root,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString(),
    ).data;
  } catch (error) {
    let code = "unknown";
    for (const output of [error.stdout, error.stderr])
      try {
        const problem = JSON.parse(output?.toString() || "{}");
        const value = problem.error?.code || problem.code;
        if (typeof value === "string" && /^[a-z_0-9]+$/.test(value))
          code = value;
      } catch {}
    throw new Error(
      `The official CLI could not publish the disposable demo (${code}). No raw credential-bearing output was printed.`,
    );
  }
}
const receiptPath = join(root, "demo-receipts.json");
let record;
try {
  record = JSON.parse(await readFile(receiptPath, "utf8"));
} catch {
  record = { versions: [] };
}
for (const release of [1, 2]) {
  if (record.versions.some((v) => v.release === release)) continue;
  const dir = join(root, `release-${release}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), renderRelease(release));
  await writeFile(
    join(dir, "sf.jsonc"),
    JSON.stringify({
      name: roundTrip
        ? "Time Machine Round Trip Lab"
        : restoreLab
          ? "Time Machine Restore Lab"
          : "Orbital Studio · Time Machine demo",
    }),
  );
  const data = sf([
    "publish",
    dir,
    "--team",
    "abneybriar-team",
    ...(record.space
      ? ["--space", record.space.id]
      : [
          "--slug",
          roundTrip
            ? "tm-round-trip-1015"
            : restoreLab
              ? "tm-restore-lab-1015"
              : "tm-orbital-lab-1015",
          "--hostname-scope",
          "global",
          "--access",
          "public",
        ]),
    "--message",
    release === 1
      ? "A warmer welcome: the Terra release"
      : "Room to grow: the Verdant release",
    "--prebuilt",
    "--wait",
  ]);
  record.space = {
    id: data.space.id,
    title: data.space.title,
    slug: data.space.slug,
    status: data.space.status,
    disabled: !!data.space.disabled,
    liveUrl: data.space.liveUrl,
    liveVersionId: data.space.channels?.live?.versionId || data.version.id,
    updatedAt: data.space.updatedAt,
    teamSlug: data.space.teamSlug || "abneybriar-team",
  };
  const v = data.version;
  record.versions.push({
    release,
    id: v.id,
    spaceId: data.space.id,
    number: v.number,
    status: v.status,
    immutableUrl: v.immutableUrl,
    immutableUrlStatus: v.immutableUrlStatus || "ready",
    createdAt: v.createdAt,
    readyAt: v.readyAt,
    fileCount: v.fileCount,
    totalBytes: v.totalBytes,
    gitCommitSha: v.gitCommitSha || null,
    message:
      v.source?.message ||
      (release === 1
        ? "A warmer welcome: the Terra release"
        : "Room to grow: the Verdant release"),
    branch: null,
    publisher: "Spacefast Time Machine demo",
  });
  await writeFile(receiptPath, JSON.stringify(record, null, 2));
  console.log(
    JSON.stringify({
      release,
      spaceId: data.space.id,
      versionId: v.id,
      immutableUrl: v.immutableUrl,
      status: v.status,
    }),
  );
}
if (!record.publicVersions) {
  sf([
    "share",
    "grant",
    "--space",
    record.space.id,
    "--team",
    "abneybriar-team",
    "--to",
    "public",
    "--role",
    "viewer",
    "--path",
    "/**",
    "--target",
    "all-versions",
    "--name",
    "Public demo versions",
    "--wait",
  ]);
  record.publicVersions = true;
  await writeFile(receiptPath, JSON.stringify(record, null, 2));
}
const details = sf([
  "spaces",
  "get",
  "--space",
  record.space.id,
  "--team",
  "abneybriar-team",
]);
const current = details.space;
record.space = {
  id: current.id,
  title: current.title,
  slug: current.slug,
  status: current.status,
  disabled: !!current.disabled,
  liveUrl: current.liveUrl,
  liveVersionId: current.channels?.live?.versionId || null,
  updatedAt: current.updatedAt,
  teamSlug: current.teamSlug,
};
const versions = record.versions
  .map((saved) => {
    const v = sf([
      "versions",
      "get",
      saved.id,
      "--space",
      current.id,
      "--team",
      "abneybriar-team",
    ]).version;
    return {
      ...saved,
      createdAt: v.createdAt,
      readyAt: v.readyAt || null,
      fileCount: v.fileCount ?? null,
      totalBytes: v.totalBytes ?? null,
      filesAddedCount: v.filesAddedCount,
      filesChangedCount: v.filesChangedCount,
      filesRemovedCount: v.filesRemovedCount,
      isCurrentProduction: v.id === record.space.liveVersionId,
    };
  })
  .reverse();
await writeFile(
  roundTrip
    ? ".local/round-trip-demo.json"
    : restoreLab
      ? ".local/restore-demo.json"
      : "src/demo.json",
  JSON.stringify(
    { capturedAt: new Date().toISOString(), space: record.space, versions },
    null,
    2,
  ),
);
console.log(
  "Public demo metadata recorded. No account credential is included.",
);
