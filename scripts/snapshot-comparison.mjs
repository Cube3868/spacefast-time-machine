import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const demo = JSON.parse(await readFile("src/demo.json", "utf8"));
const cli = join(process.env.APPDATA, "npm/node_modules/spacefast/dist/cli.js");
const pairs = {};
for (const target of demo.versions) {
  const base = demo.versions.find((v) => v.id !== target.id);
  const query = new URLSearchParams({
    baseVersionId: base.id,
    versionId: target.id,
    limit: "100",
  });
  const fetchComparison = (path) => {
    const params = new URLSearchParams(query);
    if (path) params.set("path", path);
    try {
      return JSON.parse(
        execFileSync(
          process.execPath,
          [
            cli,
            "api",
            "GET",
            `/v1/spaces/${demo.space.id}/versions/compare?${params}`,
            "--json",
          ],
          {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 4 * 1024 * 1024,
          },
        ).toString(),
      ).data;
    } catch {
      throw new Error(
        "The official CLI could not read the public demo comparison. No credential-bearing output was printed.",
      );
    }
  };
  const summary = fetchComparison();
  const files = {};
  for (const file of summary.files)
    files[file.path] = fetchComparison(file.path).file;
  pairs[`${base.id}:${target.id}`] = { summary, files };
}
await writeFile(
  "src/demo-comparison.json",
  JSON.stringify({ capturedAt: new Date().toISOString(), pairs }, null, 2),
);
console.log(
  JSON.stringify(
    Object.values(pairs).map((p) => ({
      base: p.summary.baseDeploymentVersionId,
      target: p.summary.deploymentVersionId,
      stats: p.summary.stats,
      paths: Object.keys(p.files),
    })),
  ),
);
