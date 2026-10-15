import { execFileSync } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const git = (...args) =>
  execFileSync("git", args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const escape = (text) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export async function packageSource() {
  let revision;
  try {
    revision = git("rev-parse", "HEAD").toString().trim();
  } catch {
    throw new Error(
      "Commit the reviewed source before building a release. Source packages must reflect HEAD.",
    );
  }
  const files = git("ls-tree", "-r", "--name-only", "-z", "HEAD")
    .toString()
    .split("\0")
    .filter(Boolean);
  if (
    files.some((path) =>
      /(^|\/)(\.env[^/]*|auth\.json|state\.json|node_modules|artifacts)(\/|$)/i.test(
        path,
      ),
    )
  )
    throw new Error(
      "Refusing to package secret/state paths in the source repository.",
    );
  const bare = resolve(".local", `source-${revision}.git`);
  await mkdir(".local", { recursive: true });
  if (!existsSync(bare))
    git("clone", "--bare", "--no-hardlinks", "--quiet", ".", bare);
  git("-C", bare, "update-server-info");
  await mkdir("dist/source.git", { recursive: true });
  for (const name of ["HEAD", "objects", "refs", "info", "packed-refs"])
    if (existsSync(join(bare, name)))
      await cp(join(bare, name), join("dist/source.git", name), {
        recursive: true,
      });
  await mkdir("dist/source/files", { recursive: true });
  git("bundle", "create", "dist/source/spacefast-time-machine.bundle", "main");
  await writeFile(
    "dist/source/spacefast-time-machine.tar.gz",
    git(
      "archive",
      "--format=tar.gz",
      "--prefix=spacefast-time-machine/",
      "HEAD",
    ),
  );
  const css = `:root{color-scheme:light;font-family:system-ui,sans-serif;color:#253426;background:#f5f7f2}*{box-sizing:border-box}body{margin:0}main{max-width:1080px;margin:auto;padding:45px 24px}header{display:flex;align-items:center;justify-content:space-between;gap:15px;border-bottom:1px solid #dce3d6;padding-bottom:22px}h1{font-size:28px;letter-spacing:-1px;margin:20px 0 12px;font-weight:550}p{color:#5f7058;line-height:1.8;font-size:14px}a{color:#3e6130;text-underline-offset:4px}a:focus-visible{outline:3px solid #7d65d5;outline-offset:4px}.tag{font-size:11px;letter-spacing:2px;color:#637953}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}.button{background:#233522;color:white;text-decoration:none;padding:11px 15px;border-radius:6px;font-size:13px}.secondary{background:#e3ecd9;color:#3a582c}code{font-family:Consolas,monospace;font-size:12px;overflow-wrap:anywhere}pre{overflow:auto;background:white;border:1px solid #dfe6da;border-radius:8px;padding:20px;font-size:12px;line-height:1.7;tab-size:2}ul{list-style:none;background:white;border:1px solid #dce3d5;border-radius:9px;padding:0;overflow:hidden}li{padding:12px 18px;border-bottom:1px solid #edf0e8;font-size:13px}li:last-child{border:0}.hash{font-size:11px;color:#637357}footer{margin-top:30px;font-size:12px;color:#637357}nav{font-size:12px;display:flex;gap:14px}details{margin:25px 0}summary{cursor:pointer;font-weight:600}h2{font-size:19px;font-weight:550}small{font-size:12px;color:#65785b}`;
  const shell = (title, body) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Spacefast Time Machine source</title><style>${css}</style></head><body><main><header><a href="/" class="tag">SPACEFAST / TIME MACHINE</a><nav><a href="/source/">Repository</a><a href="/source/files/LICENSE.html">MIT license</a></nav></header>${body}<footer>Independent open-source software · hosted on Spacefast · commit ${revision.slice(0, 12)}</footer></main></body></html>`;
  const links = [];
  for (const path of files) {
    const buffer = git("show", `HEAD:${path}`);
    if (buffer.includes(0)) continue;
    const content = buffer.toString("utf8");
    if (/sf[acm]_[A-Za-z0-9]{32,}/.test(content))
      throw new Error(
        `Credential-like content found in ${path}; review before publishing.`,
      );
    const target = join("dist/source/files", `${path}.html`);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(
      target,
      shell(
        path,
        `<p><a href="/source/">← All files</a></p><h1>${escape(path)}</h1><p class="hash">${revision}</p><pre><code>${escape(content)}</code></pre>`,
      ),
    );
    links.push(
      `<li><a href="/source/files/${path.split("/").map(encodeURIComponent).join("/")}.html">${escape(path)}</a></li>`,
    );
  }
  const readme = git("show", "HEAD:README.md").toString();
  await writeFile(
    "dist/source/index.html",
    shell(
      "Repository",
      `<p class="tag" style="margin-top:30px">PUBLIC SOURCE REPOSITORY / MIT</p><h1>Spacefast Time Machine</h1><p>A polished, independent time machine for your Spacefast deployments. Browse the committed source, clone the Git repository, or download an archive. This repository is hosted on Spacefast with the application.</p><p class="hash">Branch: main · Commit: ${revision}</p><div class="actions"><a class="button" href="/source/spacefast-time-machine.tar.gz" download>Download source archive ↓</a><a class="button secondary" href="/source/spacefast-time-machine.bundle" download>Download Git bundle ↓</a><a class="button secondary" href="/">Open application ↗</a></div><h2>Clone this repository</h2><p><small>Use this site's origin, followed by <code>/source.git</code>. Serial requests avoid intermittent errors from parallel object downloads.</small></p><pre><code>git -c http.maxRequests=1 clone https://space-xx8uckgsp.space.fast/source.git spacefast-time-machine</code></pre><p><small>If HTTP cloning fails, download the Git bundle above, then clone it locally. The bundle includes the main branch and its complete history.</small></p><pre><code>git clone -b main spacefast-time-machine.bundle spacefast-time-machine</code></pre><h2>Files <small>(${links.length})</small></h2><ul>${links.join("")}</ul><details><summary>Read the README</summary><pre>${escape(readme)}</pre></details>`,
    ),
  );
  await writeFile(
    "dist/source/revision.json",
    JSON.stringify(
      { revision, branch: "main", license: "MIT", files: files.length },
      null,
      2,
    ),
  );
  console.log(
    `Packaged source browser, archive and HTTP Git repository at ${revision.slice(0, 12)}.`,
  );
}
