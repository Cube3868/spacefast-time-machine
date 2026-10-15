import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { packageSource } from "./package-source.mjs";
import { parse } from "jsonc-parser";
await mkdir("dist", { recursive: true });
await cp("functions", "dist/functions", { recursive: true });
const config = parse(await readFile("sf.jsonc", "utf8"));
delete config.build;
await writeFile("dist/sf.jsonc", JSON.stringify(config, null, 2));
await mkdir("dist/licenses", { recursive: true });
for (const name of [
  "react",
  "react-dom",
  "lucide-react",
  "diff",
  "@fontsource-variable/dm-sans",
  "@fontsource-variable/manrope",
]) {
  await cp(
    `node_modules/${name}/LICENSE`,
    `dist/licenses/${name.replaceAll("/", "-")}.txt`,
  );
}
console.log("Packaged Spacefast Functions with the static frontend.");
await packageSource();
