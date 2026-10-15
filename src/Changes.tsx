import { useEffect, useMemo, useRef, useState } from "react";
import { diffLines } from "diff";
import { ArrowRight, FileDiff, LoaderCircle, Search } from "lucide-react";
import { api } from "./api";
import snapshot from "./demo-comparison.json";
import type { DeploymentComparison, FileComparison, Version } from "./types";

const label = (v: Version) =>
  v.number == null ? v.id.slice(0, 16) : `v${v.number}`;
const reason = (v: string | null) =>
  ({
    not_present: "File not present in this version.",
    binary: "Binary content cannot be shown as text.",
    too_large:
      "Text unavailable: the file exceeds Spacefast’s comparison limit.",
    unavailable: "Spacefast could not retrieve this content.",
  })[v || ""] || "Text content is unavailable.";
function TextSide({
  title,
  text,
  unavailable,
}: {
  title: string;
  text: string | null;
  unavailable: string | null;
}) {
  return (
    <section className="text-side" aria-label={title}>
      <h4>{title}</h4>
      {text === null ? (
        <p className="file-reason">{reason(unavailable)}</p>
      ) : (
        <pre tabIndex={0} aria-label={`${title} file text`}>
          <code>{text.slice(0, 240000)}</code>
        </pre>
      )}
      {text && text.length > 240000 && (
        <p className="file-reason">
          Display limited to the first 240,000 characters.
        </p>
      )}
    </section>
  );
}
function FileText({
  file,
  base,
  target,
}: {
  file: FileComparison;
  base: Version;
  target: Version;
}) {
  const [split, setSplit] = useState(false);
  const changes = useMemo(
    () =>
      file.before !== null &&
      file.after !== null &&
      file.before.length + file.after.length <= 480000
        ? diffLines(file.before, file.after, {
            timeout: 100,
            maxEditLength: 2000,
          })
        : undefined,
    [file],
  );
  let oldLine = 1,
    newLine = 1;
  const rows = changes?.flatMap((part) => {
    const lines = part.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return lines.map((text) => ({
      text,
      kind: part.added ? "added" : part.removed ? "removed" : "same",
      old: part.added ? null : oldLine++,
      next: part.removed ? null : newLine++,
    }));
  });
  return (
    <div className="file-text">
      <div className="file-text-head">
        <strong>{file.path}</strong>
        <button
          className="button small outline"
          onClick={() => setSplit((v) => !v)}
          aria-pressed={split}
        >
          {split ? "Unified diff" : "Before / after"}
        </button>
      </div>
      {!split && rows ? (
        <>
          <div
            className="diff-scroll"
            tabIndex={0}
            role="region"
            aria-label={`Changes to ${file.path}`}
          >
            <table className="diff-table">
              <caption className="sr-only">
                Removed lines have a minus sign; added lines have a plus sign.
              </caption>
              <thead className="sr-only">
                <tr>
                  <th>Before line</th>
                  <th>After line</th>
                  <th>Change</th>
                  <th>Text</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 3000).map((r, i) => (
                  <tr className={r.kind} key={i}>
                    <td>{r.old}</td>
                    <td>{r.next}</td>
                    <td>
                      {r.kind === "added"
                        ? "+"
                        : r.kind === "removed"
                          ? "−"
                          : " "}
                    </td>
                    <td>
                      <code>{r.text || " "}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 3000 && (
            <p className="file-reason">
              Showing the first 3,000 diff lines. Use Before / after to inspect
              the text.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="text-sides">
            <TextSide
              title={`Before · ${label(base)}`}
              text={file.before}
              unavailable={file.beforeReason}
            />
            <TextSide
              title={`After · ${label(target)}`}
              text={file.after}
              unavailable={file.afterReason}
            />
          </div>
          {!split && file.before !== null && file.after !== null && (
            <p className="file-reason">
              Line highlighting is unavailable for this large comparison. Before
              and after text is shown.
            </p>
          )}
        </>
      )}
    </div>
  );
}
export function Changes({
  spaceId,
  base,
  target,
  demo,
}: {
  spaceId: string;
  base?: Version;
  target?: Version;
  demo: boolean;
}) {
  const generation = useRef(0);
  const [summary, setSummary] = useState<DeploymentComparison | null>(null),
    [file, setFile] = useState<FileComparison | null>(null);
  const [path, setPath] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [fileError, setFileError] = useState("");
  const [loading, setLoading] = useState(false),
    [fileLoading, setFileLoading] = useState(false),
    [more, setMore] = useState(false);
  const pair = base && target ? `${base.id}:${target.id}` : "";
  const captured = (
    snapshot.pairs as unknown as Record<
      string,
      { summary: DeploymentComparison; files: Record<string, FileComparison> }
    >
  )[pair];
  const params = () =>
    new URLSearchParams({
      spaceId,
      baseVersionId: base!.id,
      versionId: target!.id,
    });
  useEffect(() => {
    generation.current++;
    setMore(false);
    setSummary(null);
    setFile(null);
    setPath("");
    setError("");
    setQuery("");
    if (
      !base ||
      !target ||
      base.id === target.id ||
      base.status !== "ready" ||
      target.status !== "ready"
    )
      return;
    const controller = new AbortController();
    setLoading(true);
    const promise = demo
      ? captured
        ? Promise.resolve({ data: captured.summary })
        : Promise.reject(new Error("This demo comparison is unavailable."))
      : api<{ data: DeploymentComparison }>(
          `/compare?${params()}`,
          undefined,
          controller.signal,
        );
    promise
      .then((r) => {
        if (!controller.signal.aborted) {
          setSummary(r.data);
          setPath(r.data.files[0]?.path || "");
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [spaceId, pair, demo]);
  useEffect(() => {
    setFile(null);
    setFileError("");
    if (!path || !base || !target) return;
    const controller = new AbortController();
    setFileLoading(true);
    const q = params();
    q.set("path", path);
    const promise = demo
      ? Promise.resolve({ data: { file: captured?.files[path] || null } })
      : api<{ data: { file: FileComparison | null } }>(
          `/compare?${q}`,
          undefined,
          controller.signal,
        );
    promise
      .then((r) => {
        if (!controller.signal.aborted) {
          if (r.data.file) setFile(r.data.file);
          else setFileError("Spacefast did not return text for this path.");
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") setFileError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setFileLoading(false);
      });
    return () => controller.abort();
  }, [path, spaceId, pair, demo]);
  async function loadMore() {
    if (!summary?.pagination.nextCursor) return;
    setMore(true);
    const requestGeneration = generation.current;
    try {
      const q = params();
      q.set("cursor", summary.pagination.nextCursor);
      const r = await api<{ data: DeploymentComparison }>(`/compare?${q}`);
      if (requestGeneration !== generation.current) return;
      setSummary(
        (s) =>
          s && {
            ...r.data,
            files: [
              ...s.files,
              ...r.data.files.filter(
                (f) => !s.files.some((old) => old.path === f.path),
              ),
            ],
          },
      );
    } catch (e) {
      if (requestGeneration === generation.current)
        setError((e as Error).message);
    } finally {
      if (requestGeneration === generation.current) setMore(false);
    }
  }
  if (
    !base ||
    !target ||
    base.id === target.id ||
    base.status !== "ready" ||
    target.status !== "ready"
  )
    return (
      <div className="changes-empty">
        <FileDiff size={26} />
        <h3>Choose two ready versions</h3>
        <p>File changes are available between completed deployments.</p>
      </div>
    );
  return (
    <div className="changes-view">
      <div className="compare-toolbar">
        <div>
          <span className="eyebrow">WHAT CHANGED</span>
          <h3>
            {label(base)} <ArrowRight size={17} /> {label(target)}
          </h3>
        </div>
        <span className="changes-scope">Served files</span>
      </div>
      <p className="changes-note">
        {demo
          ? `Real API snapshot · ${new Date(snapshot.capturedAt).toLocaleDateString()}. `
          : ""}
        This compares deployed files. Git source and database content are not
        included.
      </p>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <p className="changes-loading" role="status">
          <LoaderCircle className="spin" size={17} /> Loading deployment
          changes…
        </p>
      )}
      {summary && (
        <>
          <div className="change-counts" aria-label="File change totals">
            <span>
              <b>{summary.stats.added}</b> added
            </span>
            <span>
              <b>{summary.stats.modified}</b> modified
            </span>
            <span>
              <b>{summary.stats.deleted}</b> removed
            </span>
          </div>
          {summary.stats.files === 0 ? (
            <div className="changes-empty">
              <h3>No file changes</h3>
              <p>These deployments serve identical files.</p>
            </div>
          ) : (
            <>
              <div className="changed-files-head">
                <label>
                  <Search size={14} />
                  <input
                    aria-label="Search changed files"
                    placeholder="Find a changed file…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <span>
                  {summary.files.length}{" "}
                  {summary.files.length === 1 ? "path" : "paths"} loaded
                </span>
              </div>
              <div
                className="changed-files"
                aria-label="Changed deployment files"
              >
                {summary.files
                  .filter((f) =>
                    f.path.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((f) => (
                    <button
                      key={f.path}
                      aria-pressed={path === f.path}
                      onClick={() => setPath(f.path)}
                    >
                      <FileDiff size={15} />
                      <strong>{f.path}</strong>
                      <span className={`file-state ${f.state}`}>
                        {f.state === "deleted"
                          ? "Removed"
                          : f.state === "added"
                            ? "Added"
                            : "Modified"}
                      </span>
                    </button>
                  ))}
              </div>
              {summary.pagination.hasMore && (
                <button
                  className="load-more"
                  disabled={more}
                  onClick={loadMore}
                >
                  {more ? "Loading…" : "Load more changed files"}
                </button>
              )}
              {summary.pagination.hasMore && (
                <p className="changes-note">Search covers the loaded paths.</p>
              )}
              {fileLoading && (
                <p className="changes-loading" role="status">
                  <LoaderCircle className="spin" size={16} /> Loading file text…
                </p>
              )}
              {fileError && (
                <div className="alert" role="alert">
                  {fileError}
                </div>
              )}
              {file && (
                <FileText
                  key={`${pair}:${file.path}`}
                  file={file}
                  base={base}
                  target={target}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
