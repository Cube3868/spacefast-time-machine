import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  Copy,
  FileDiff,
  ChevronDown,
  Clock3,
  Code2,
  ExternalLink,
  GitBranch,
  Globe2,
  History,
  Info,
  Layers3,
  LayoutGrid,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Monitor,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  SplitSquareHorizontal,
  Terminal,
  Undo2,
  X,
} from "lucide-react";
import { api, ApiError } from "./api";
import { RestoreActivity } from "./RestoreActivity";
import {
  comparisonPath,
  readComparisonLink,
  type ComparisonView,
} from "./navigation";
import demoSnapshot from "./demo.json";
const demoSpace = demoSnapshot.space as Space;
const demoVersions = demoSnapshot.versions as Version[];
import type { Account, Page, Restore, Space, Version } from "./types";
const Changes = lazy(() =>
  import("./Changes").then((module) => ({ default: module.Changes })),
);

const emptyPage: Page = { hasMore: false, nextCursor: null };
const sortVersions = (versions: Version[]) =>
  [...versions].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      (b.number ?? 0) - (a.number ?? 0),
  );
const versionLabel = (v: Version) =>
  v.number == null ? "Pending version" : `v${v.number}`;
const formatDate = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const formatTime = (s: string) =>
  new Date(s).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
const bytes = (n: number | null) =>
  n == null
    ? "Unavailable"
    : n < 1024
      ? `${n} B`
      : n < 1024 * 1024
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1024 / 1024).toFixed(1)} MB`;
function Status({ status, live = false }: { status: string; live?: boolean }) {
  const style =
    live || status === "ready" || status === "active"
      ? "green"
      : ["failed", "expired", "canceled", "disabled"].includes(status)
        ? "red"
        : "amber";
  return (
    <span className={`status ${style}`}>
      <span />
      {live ? "Live" : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            className="icon-btn"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function Preview({
  version,
  demo,
  mobile,
}: {
  version?: Version;
  demo: boolean;
  mobile: boolean;
}) {
  const [load, setLoad] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState(320);
  const [size, setSize] = useState({ width: mobile ? 390 : 1280, height: 900 });
  const widthId = useId(),
    heightId = useId();
  const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(max, n));
  const scale = Math.min(1, bounds / size.width);
  useEffect(() => {
    setSize({ width: mobile ? 390 : 1280, height: 900 });
  }, [mobile]);
  useEffect(() => {
    if (!wrap.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setBounds(entry.contentRect.width),
    );
    observer.observe(wrap.current);
    return () => observer.disconnect();
  }, [
    version?.id,
    version?.status,
    version?.immutableUrl,
    version?.immutableUrlStatus,
  ]);
  const [verified, setVerified] = useState(false);
  const [useDirect, setUseDirect] = useState(true),
    [slow, setSlow] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null),
    [previewError, setPreviewError] = useState(""),
    [reload, setReload] = useState(0);
  const available =
    version?.status === "ready" &&
    version.immutableUrl &&
    version.immutableUrlStatus !== "pending";
  useEffect(() => {
    setLoad(false);
    setPreviewUrl(null);
    setPreviewError("");
    setSlow(false);
    setVerified(false);
    if (!available || !version) return;
    if (useDirect) {
      setPreviewUrl(version.immutableUrl);
      return;
    }
    const controller = new AbortController();
    api<{ url: string }>(
      "/preview",
      { spaceId: version.spaceId, versionId: version.id },
      controller.signal,
    )
      .then((result) => setPreviewUrl(result.url))
      .catch((error) => {
        if (error.name !== "AbortError") setPreviewError(error.message);
      });
    return () => controller.abort();
  }, [version?.id, demo, available, reload, useDirect]);
  useEffect(() => {
    if (!previewUrl || verified) return;
    const timer = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(timer);
  }, [previewUrl, verified]);
  useEffect(() => {
    if (!demo || !previewUrl || !version) return;
    const origin = new URL(previewUrl).origin;
    const ready = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        event.origin === origin &&
        event.data?.type === "spacefast-time-machine:preview-ready" &&
        event.data.release === version.release
      ) {
        setVerified(true);
        setLoad(true);
      }
    };
    window.addEventListener("message", ready);
    return () => window.removeEventListener("message", ready);
  }, [demo, previewUrl, version?.id]);
  return (
    <div className="preview-content">
      {available && version ? (
        <>
          <div className="viewport-controls">
            <details>
              <summary
                aria-label={`Set viewport size for ${versionLabel(version)}`}
              >
                {size.width} × {size.height} <ChevronDown size={11} />
              </summary>
              <div className="viewport-inputs">
                <label htmlFor={widthId}>
                  Width{" "}
                  <input
                    id={widthId}
                    type="number"
                    min="240"
                    max="2560"
                    step="10"
                    value={size.width}
                    onChange={(e) =>
                      setSize((s) => ({
                        ...s,
                        width: clamp(Number(e.target.value), 240, 2560),
                      }))
                    }
                  />
                </label>
                <label htmlFor={heightId}>
                  Height{" "}
                  <input
                    id={heightId}
                    type="number"
                    min="240"
                    max="1800"
                    step="10"
                    value={size.height}
                    onChange={(e) =>
                      setSize((s) => ({
                        ...s,
                        height: clamp(Number(e.target.value), 240, 1800),
                      }))
                    }
                  />
                </label>
              </div>
            </details>
            <span>Fit {Math.round(scale * 100)}%</span>
            <button
              className="icon-btn"
              aria-label={`Reset preview size for ${versionLabel(version)}`}
              onClick={() =>
                setSize({ width: mobile ? 390 : 1280, height: 900 })
              }
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div
            ref={wrap}
            className={`frame-wrap resizable-frame ${mobile ? "mobile-frame" : ""}`}
            style={{ height: Math.round(size.height * scale) }}
          >
            {previewUrl ? (
              <iframe
                ref={frame}
                key={`${version.id}-${reload}-${useDirect}`}
                title={`Preview of ${versionLabel(version)}`}
                sandbox="allow-scripts allow-forms allow-same-origin"
                referrerPolicy="no-referrer"
                onLoad={() => {
                  setLoad(true);
                  if (demo && previewUrl)
                    frame.current?.contentWindow?.postMessage(
                      { type: "spacefast-time-machine:preview-ping" },
                      new URL(previewUrl).origin,
                    );
                }}
                src={previewUrl}
                style={{
                  width: size.width,
                  height: size.height,
                  transform: `scale(${scale})`,
                }}
              />
            ) : previewError ? (
              <div className="preview-empty">
                <LockKeyhole size={26} />
                <strong>Secure preview unavailable</strong>
                <p>{previewError}</p>
              </div>
            ) : null}
            <button
              className="resize-grip"
              aria-label={`Resize preview of ${versionLabel(version)}`}
              title="Drag to resize. Arrow keys change width or height; Shift uses larger steps."
              onPointerDown={(e) => {
                e.preventDefault();
                const target = e.currentTarget;
                target.setPointerCapture(e.pointerId);
                const start = { x: e.clientX, y: e.clientY, ...size };
                const move = (event: PointerEvent) =>
                  setSize({
                    width: clamp(
                      Math.round(
                        start.width + (event.clientX - start.x) / scale,
                      ),
                      240,
                      2560,
                    ),
                    height: clamp(
                      Math.round(
                        start.height + (event.clientY - start.y) / scale,
                      ),
                      240,
                      1800,
                    ),
                  });
                const up = () => {
                  target.removeEventListener("pointermove", move);
                  target.removeEventListener("pointerup", up);
                  target.removeEventListener("pointercancel", up);
                };
                target.addEventListener("pointermove", move);
                target.addEventListener("pointerup", up);
                target.addEventListener("pointercancel", up);
              }}
              onKeyDown={(e) => {
                if (
                  ![
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    "Home",
                  ].includes(e.key)
                )
                  return;
                e.preventDefault();
                const step = e.shiftKey ? 100 : 10;
                setSize((s) =>
                  e.key === "Home"
                    ? { width: mobile ? 390 : 1280, height: 900 }
                    : {
                        width: clamp(
                          s.width +
                            (e.key === "ArrowRight"
                              ? step
                              : e.key === "ArrowLeft"
                                ? -step
                                : 0),
                          240,
                          2560,
                        ),
                        height: clamp(
                          s.height +
                            (e.key === "ArrowDown"
                              ? step
                              : e.key === "ArrowUp"
                                ? -step
                                : 0),
                          240,
                          1800,
                        ),
                      },
                );
              }}
            >
              <span aria-hidden="true">◢</span>
            </button>
          </div>
          {(!load || (demo && !verified)) && !previewError && (
            <div className="preview-loading">
              {slow ? (
                <span>
                  Preview could not be verified. Open the version in a new tab,
                  or try another preview mode.
                </span>
              ) : (
                <>
                  <LoaderCircle size={18} className="spin" /> Loading preview…
                </>
              )}
            </div>
          )}
          <div className="frame-note">
            <ExternalLink size={13} />
            <span>
              {verified
                ? "Live demo rendered and verified. "
                : load
                  ? "Frame loaded; cross-origin content cannot be verified. "
                  : ""}
              <a href={version.immutableUrl!} target="_blank" rel="noreferrer">
                Open version in a new tab ↗
              </a>
              {!demo &&
                " · Blank or blocked? Use this link to view it directly."}
            </span>
          </div>
          {!demo && (
            <div className="frame-note">
              <Info size={13} />
              <span>
                {useDirect
                  ? "Immutable version link. For a private version, try a secure preview session."
                  : "Short-lived, version-only preview. Site policies and browser cookies can limit framing."}
                <button
                  className="preview-retry"
                  onClick={() => setUseDirect((value) => !value)}
                >
                  {useDirect
                    ? "Use secure preview session"
                    : "Use immutable version link"}
                </button>
                <button
                  className="preview-retry"
                  onClick={() => setReload((n) => n + 1)}
                >
                  Refresh preview
                </button>
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="preview-empty">
          <LayoutGrid size={28} />
          <strong>
            {version?.status === "failed"
              ? "This version didn’t deploy"
              : "Preview unavailable"}
          </strong>
          <p>
            {version?.failureMessage ||
              (version?.immutableUrlStatus === "pending"
                ? "The immutable version URL is still provisioning."
                : "Select a ready version with an available version URL.")}
          </p>
        </div>
      )}
    </div>
  );
}

export function App() {
  const initialLink = useRef(readComparisonLink(location.search));
  const initialSpaceApplied = useRef(false),
    linkConsumed = useRef(false);
  const [linkReady, setLinkReady] = useState(false),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const [account, setAccount] = useState<Account>({ connected: false });
  const [checking, setChecking] = useState(true),
    [demo, setDemo] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]),
    [spacePage, setSpacePage] = useState<Page>(emptyPage),
    [spaceId, setSpaceId] = useState("");
  const [space, setSpace] = useState<Space | null>(null),
    [versions, setVersions] = useState<Version[]>([]),
    [versionPage, setVersionPage] = useState<Page>(emptyPage);
  const [selectedId, setSelectedId] = useState(""),
    [compareId, setCompareId] = useState("");
  const [loading, setLoading] = useState(false),
    [spacesLoading, setSpacesLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [versionQuery, setVersionQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const [tab, setTab] = useState<ComparisonView>(initialLink.current.view),
    [mobile, setMobile] = useState(false),
    [menu, setMenu] = useState(false);
  const [compactNav, setCompactNav] = useState(
    () => matchMedia("(max-width: 760px)").matches,
  );
  const [modal, setModal] = useState<
      "connect" | "capabilities" | "restore" | "share" | "activity" | null
    >(null),
    [restoreAccess, setRestoreAccess] = useState(false);
  const [connecting, setConnecting] = useState(false),
    [connectionError, setConnectionError] = useState("");
  const [restore, setRestore] = useState<Restore | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [restoreError, setRestoreError] = useState("");
  const [pendingTicket, setPendingTicket] = useState<string | null>(null),
    [refreshKey, setRefreshKey] = useState(0),
    [restoreCheck, setRestoreCheck] = useState(0);
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const selected = versions.find((v) => v.id === selectedId),
    compared = versions.find((v) => v.id === compareId);
  const visibleVersions = versions.filter(
    (v) =>
      (filter === "all" ||
        (filter === "live"
          ? v.id === space?.liveVersionId
          : v.status === filter)) &&
      `${versionLabel(v)} ${v.message || ""} ${v.gitCommitSha || ""}`
        .toLowerCase()
        .includes(versionQuery.toLowerCase()),
  );
  const liveVersion = versions.find((v) => v.id === space?.liveVersionId);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const change = () => setCompactNav(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!menu || !compactNav) return;
    const prior = document.activeElement as HTMLElement;
    const nav = document.getElementById("sidebar")!;
    const controls = () =>
      Array.from(
        nav.querySelectorAll<HTMLElement>(
          "a[href], button:not(:disabled), input:not(:disabled)",
        ),
      );
    controls()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
      if (e.key === "Tab") {
        const items = controls(),
          first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prior?.focus();
    };
  }, [menu, compactNav]);
  useEffect(() => {
    if (initialLink.current.demo) explore(initialLink.current);
    const controller = new AbortController();
    api<Account>("/session", undefined, controller.signal)
      .then((result) => {
        setAccount(result);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => setChecking(false));
    if (new URLSearchParams(location.search).has("auth_error")) {
      setError(
        "Spacefast sign-in was declined or could not be completed. You can try connecting again.",
      );
      const clean = new URL(location.href);
      clean.searchParams.delete("auth_error");
      history.replaceState(null, "", clean.pathname + clean.search);
    }
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!account.connected || demo) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSpacesLoading(true);
      api<{ data: Space[]; pagination: Page }>(
        `/spaces?query=${encodeURIComponent(query)}`,
        undefined,
        controller.signal,
      )
        .then((r) => {
          setSpaces(r.data);
          setSpacePage(r.pagination);
          const requestedSpace = !initialSpaceApplied.current
            ? initialLink.current.spaceId
            : "";
          initialSpaceApplied.current = true;
          setSpaceId((prev) => {
            if (requestedSpace) return requestedSpace;
            return r.data.some((s) => s.id === prev)
              ? prev
              : r.data[0]?.id || "";
          });
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSpacesLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [account.connected, demo, query]);
  useEffect(() => {
    if (demo || !spaceId || !account.connected) return;
    const controller = new AbortController();
    setLoading(true);
    setVersions([]);
    setSpace(null);
    setError("");
    setVersionPage(emptyPage);
    api<{ space: Space; data: Version[]; pagination: Page }>(
      `/history?spaceId=${encodeURIComponent(spaceId)}`,
      undefined,
      controller.signal,
    )
      .then(async (r) => {
        const linked =
          !linkConsumed.current && initialLink.current.spaceId === spaceId
            ? initialLink.current
            : null;
        const needed = linked
          ? [
              ...new Set(
                [linked.versionId, linked.compareId].filter(
                  (id) => id && !r.data.some((v) => v.id === id),
                ),
              ),
            ]
          : [];
        const pinned = await Promise.all(
          needed.map((versionId) =>
            api<{ data: Version }>(
              `/version?spaceId=${encodeURIComponent(spaceId)}&versionId=${encodeURIComponent(versionId)}`,
              undefined,
              controller.signal,
            ),
          ),
        );
        if (controller.signal.aborted) return;
        linkConsumed.current = true;
        const all = sortVersions([...r.data, ...pinned.map((p) => p.data)]);
        setSpace(r.space);
        setSpaces((prev) =>
          prev.some((s) => s.id === r.space.id) ? prev : [r.space, ...prev],
        );
        setVersions(all);
        setVersionPage(r.pagination);
        const chosen =
          linked?.versionId || r.space.liveVersionId || all[0]?.id || "";
        setSelectedId(chosen);
        setCompareId(
          linked?.compareId ||
            all.find((v) => v.status === "ready" && v.id !== chosen)?.id ||
            "",
        );
        setLinkReady(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [spaceId, demo, account.connected, refreshKey]);
  useEffect(() => {
    if (
      linkReady &&
      space?.id === spaceId &&
      selected?.spaceId === spaceId &&
      compared?.spaceId === spaceId
    )
      history.replaceState(
        null,
        "",
        comparisonPath({
          demo,
          spaceId,
          versionId: selected.id,
          compareId: compared.id,
          view: tab,
        }),
      );
  }, [linkReady, spaceId, space?.id, selected?.id, compared?.id, demo, tab]);
  useEffect(() => {
    setPendingTicket(null);
    setApprovalUrl(null);
    setNotice("");
    if (demo || !spaceId || !account.connected) return;
    const controller = new AbortController();
    api<{ tickets: string[] }>(
      `/restore/pending?spaceId=${encodeURIComponent(spaceId)}`,
      undefined,
      controller.signal,
    )
      .then((result) => {
        setPendingTicket(result.tickets[0] || null);
        if (result.tickets.length)
          setNotice(
            "An earlier restore still needs verification. Its status was recovered securely from the server.",
          );
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [spaceId, demo, account.connected]);
  useEffect(() => {
    if (!pendingTicket) return;
    let canceled = false,
      timer: ReturnType<typeof setTimeout>,
      count = 0,
      phase = "";
    const poll = async () => {
      try {
        const result = await api<{
          status: string;
          operationStatus: string;
          approvalUrl?: string | null;
        }>(`/restore/status?ticket=${encodeURIComponent(pendingTicket)}`);
        if (canceled) return;
        setApprovalUrl(result.approvalUrl || null);
        if (result.status === "verified") {
          setNotice("Restore verified. The selected version is now live.");
          setError("");
          void recoverPending();
          setRefreshKey((n) => n + 1);
          return;
        }
        if (result.status === "failed") {
          setNotice("");
          setError(
            `Spacefast reported the restore ${result.operationStatus}. Refresh before taking another action.`,
          );
          void recoverPending();
          return;
        }
        if (result.status === "unavailable") {
          setNotice("");
          setError(
            "Restore unavailable: Spacefast could not complete the approved promotion. The target has not been verified live. Review the Spacefast dashboard; another submission is blocked until this attempt is resolved.",
          );
          return;
        }
        if (phase !== result.operationStatus) {
          phase = result.operationStatus;
          count = 0;
        }
        if (++count >= (result.approvalUrl ? 200 : 40)) {
          setError(
            "The restore has not been verified yet. Refresh the Spacefast dashboard before submitting another restore.",
          );
          return;
        }
        timer = setTimeout(poll, 3000);
      } catch (e) {
        if (!canceled)
          setError(
            `${(e as Error).message} Restore verification remains pending; use “Check restore status” to retry.`,
          );
      }
    };
    void poll();
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [pendingTicket, restoreCheck]);
  function explore(link?: ReturnType<typeof readComparisonLink>) {
    history.replaceState(null, "", "/?demo=1");
    setDemo(true);
    setSpace(demoSpace);
    setSpaces([demoSpace]);
    setVersions(demoVersions);
    setSpaceId(demoSpace.id);
    setSelectedId(
      link?.versionId || demoSpace.liveVersionId || demoVersions[0].id,
    );
    setCompareId(
      link?.compareId ||
        demoVersions.find((v) => v.id !== demoSpace.liveVersionId)?.id ||
        "",
    );
    setError("");
    setNotice("");
    setMenu(false);
    setFilter("all");
    setVersionQuery("");
    setLinkReady(true);
    if (link) setTab(link.view);
    if (
      (link?.spaceId && link.spaceId !== demoSpace.id) ||
      (link?.versionId && !demoVersions.some((v) => v.id === link.versionId)) ||
      (link?.compareId && !demoVersions.some((v) => v.id === link.compareId))
    )
      setError(
        "This shared comparison is not available in the public demo. Connect your account to access your own Spaces.",
      );
  }
  function leaveDemo() {
    setLinkReady(false);
    history.replaceState(null, "", "/");
    setDemo(false);
    setSpace(null);
    setVersions([]);
    setSpaces([]);
    setSpaceId("");
    setSelectedId("");
    setCompareId("");
    setFilter("all");
    setVersionQuery("");
  }
  async function logout() {
    try {
      await api("/auth/logout", {});
      setAccount({ connected: false });
      setPendingTicket(null);
      leaveDemo();
      setNotice(
        "Disconnected. The server session and stored credentials were removed.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function moreSpaces() {
    if (!spacePage.nextCursor) return;
    setSpacesLoading(true);
    try {
      const r = await api<{ data: Space[]; pagination: Page }>(
        `/spaces?cursor=${encodeURIComponent(spacePage.nextCursor)}&query=${encodeURIComponent(query)}`,
      );
      setSpaces((prev) => [
        ...prev,
        ...r.data.filter((s) => !prev.some((p) => p.id === s.id)),
      ]);
      setSpacePage(r.pagination);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSpacesLoading(false);
    }
  }
  async function moreVersions() {
    if (!versionPage.nextCursor) return;
    setLoading(true);
    try {
      const r = await api<{ space: Space; data: Version[]; pagination: Page }>(
        `/history?spaceId=${encodeURIComponent(spaceId)}&cursor=${encodeURIComponent(versionPage.nextCursor)}`,
      );
      setVersions((prev) =>
        sortVersions([
          ...prev,
          ...r.data.filter((v) => !prev.some((p) => p.id === v.id)),
        ]),
      );
      setSpace(r.space);
      setVersionPage(r.pagination);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function prepareRestore() {
    if (!selected || demo) return;
    setBusy(true);
    setRestoreError("");
    setRestore(null);
    setConfirmation("");
    setModal("restore");
    try {
      setRestore(
        await api<Restore>("/restore/prepare", {
          spaceId,
          versionId: selected.id,
        }),
      );
    } catch (e) {
      setRestoreError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirmRestore() {
    if (!restore || confirmation !== restore.slug) return;
    setBusy(true);
    setRestoreError("");
    try {
      const result = await api<{ status: string; approvalUrl?: string }>(
        "/restore/confirm",
        {
          ticket: restore.ticket,
          confirmSlug: confirmation,
        },
      );
      setPendingTicket(restore.ticket);
      setApprovalUrl(result.approvalUrl || null);
      setNotice(
        result.status === "approval_required"
          ? "Spacefast requires your approval before this restore can run. Open the approval below; status will update automatically."
          : "Restore submitted. Waiting for Spacefast to confirm the live deployment…",
      );
      setModal(null);
    } catch (e) {
      setRestoreError((e as Error).message);
      if (
        !(e instanceof ApiError) ||
        e.status >= 500 ||
        e.code === "provider_approval_required"
      )
        setPendingTicket(restore.ticket);
    } finally {
      setBusy(false);
    }
  }
  async function recoverPending() {
    try {
      const result = await api<{ tickets: string[] }>(
        `/restore/pending?spaceId=${encodeURIComponent(spaceId)}`,
      );
      setPendingTicket(result.tickets[0] || null);
    } catch {
      // Keep the unresolved ticket and the restore gate closed if recovery fails.
      setError(
        "Restore status could not be recovered. Reconnect or check status before starting another restore.",
      );
    }
  }
  function checkRestore() {
    if (pendingTicket) {
      setError("");
      setNotice("Checking the restore status with Spacefast…");
      setRestoreCheck((n) => n + 1);
    }
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside
        id="sidebar"
        className={`sidebar ${menu ? "is-open" : ""}`}
        aria-label="Main navigation"
        inert={compactNav && !menu}
      >
        <a className="brand" href="/" aria-label="Spacefast Time Machine home">
          <span className="brand-mark">
            <History size={23} strokeWidth={2.2} />
          </span>
          <span>
            spacefast<span className="brand-sub">TIME MACHINE</span>
          </span>
        </a>
        <button className="workspace" onClick={() => setModal("connect")}>
          <span className="workspace-icon">
            {demo
              ? "O"
              : account.connected
                ? account.name?.charAt(0).toUpperCase()
                : "Y"}
          </span>
          <span>
            <b>
              {demo
                ? "Public demo"
                : account.connected
                  ? account.name
                  : "Your workspace"}
            </b>
            <small>
              {demo
                ? "Real Spacefast deployments"
                : account.connected
                  ? "Spacefast connected"
                  : "No account connected"}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        <span className="nav-caption">WORKSPACE</span>
        <button
          className="nav-item active"
          onClick={() => {
            setMenu(false);
            document
              .getElementById("timeline")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          <History size={18} /> Time machine{" "}
          <span className="nav-count">{versions.length || "—"}</span>
        </button>
        <button className="nav-item" onClick={() => setModal("capabilities")}>
          <ShieldCheck size={18} /> Capabilities{" "}
          <ArrowUpRight size={14} className="push" />
        </button>
        <a
          className="nav-item"
          href="https://spacefast.com/docs/"
          target="_blank"
          rel="noreferrer"
        >
          <Code2 size={18} /> Documentation{" "}
          <ArrowUpRight size={14} className="push" />
        </a>
        <div className="sidebar-spaces">
          <div className="nav-caption">
            YOUR SPACES <span>{spaces.length || "—"}</span>
          </div>
          <label className="side-search">
            <Search size={15} />
            <input
              aria-label="Search Spaces"
              placeholder="Find a Space…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!account.connected || demo}
            />
          </label>
          {spaces
            .filter(
              (s) =>
                !demo || s.title.toLowerCase().includes(query.toLowerCase()),
            )
            .map((s) => (
              <button
                className={`space-item ${s.id === spaceId ? "selected" : ""}`}
                key={s.id}
                onClick={() => {
                  setSpaceId(s.id);
                  setMenu(false);
                }}
              >
                <span className="space-dot" />
                <span>{s.title || s.slug}</span>
                <ArrowUpRight size={13} />
              </button>
            ))}
          {!spaces.length && (
            <p className="sidebar-hint">
              {spacesLoading
                ? "Loading your Spaces…"
                : account.connected
                  ? "No matching Spaces."
                  : "Your Spaces will appear here once you connect."}
            </p>
          )}
          {spacePage.hasMore && !demo && (
            <button
              className="side-more"
              onClick={moreSpaces}
              disabled={spacesLoading}
            >
              Load more Spaces
            </button>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="secure-note">
            <LockKeyhole size={16} />
            <div>
              <b>Your keys stay yours.</b>
              <p>Credentials never reach your browser.</p>
            </div>
          </div>
          <a
            className="source-link"
            href="https://github.com/Cube3868/spacefast-time-machine"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Code2 size={16} /> Open source, always <ArrowUpRight size={14} />
          </a>
          <div className="sidebar-foot">
            <span className="tiny-orb" /> Built on Spacefast <span>01 / ∞</span>
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn menu-toggle"
              onClick={() => setMenu(!menu)}
              aria-label="Toggle navigation"
              aria-expanded={menu}
              aria-controls="sidebar"
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb-icon">
              <Layers3 size={16} />
            </span>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>Time machine</strong>
          </div>
          <div className="top-actions">
            <span
              className={`connection-label ${account.connected && !demo ? "connected" : ""}`}
            >
              <span />
              {checking
                ? "Checking connection"
                : demo
                  ? "Live demo"
                  : account.connected
                    ? "Connected"
                    : "Not connected"}
            </span>
            {account.connected ? (
              <button
                className="icon-btn"
                aria-label="Disconnect Spacefast"
                onClick={logout}
              >
                <LogOut size={17} />
              </button>
            ) : (
              <button
                className="button small dark"
                onClick={() => setModal("connect")}
              >
                <Link2 size={14} /> Connect Spacefast
              </button>
            )}
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> YOUR WORK, THROUGH TIME
              </div>
              <h1>
                A little perspective
                <br className="mobile-break" /> on your past
                <span className="period">.</span>
              </h1>
              <p>
                Every version has a story. Find yours, compare it, bring it
                back.
              </p>
            </div>
            <div className="heading-graphic" aria-hidden="true">
              <div className="orbit o1" />
              <div className="orbit o2" />
              <div className="orbit o3" />
              <span className="orbit-core">
                <History size={24} />
              </span>
              <span className="orbit-dot" />
              <span className="orbit-star">✦</span>
            </div>
          </div>
          {!account.connected &&
            !checking &&
            !demo &&
            initialLink.current.spaceId && (
              <div className="alert" role="status">
                <Link2 size={17} />
                <span>
                  Connect Spacefast to open this shared comparison. The link
                  does not grant access to private Spaces.
                </span>
              </div>
            )}
          {error && (
            <div className="alert error" role="alert">
              <Info size={17} />
              <span>{error}</span>
              {initialLink.current.spaceId && !space && (
                <a href="/">Open workspace</a>
              )}
              <button
                className="icon-btn"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <CheckCheck size={17} />
              <span>{notice}</span>
              <button
                className="icon-btn"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {approvalUrl && pendingTicket && (
            <div className="alert" role="status">
              <ShieldCheck size={18} />
              <span>
                Spacefast is waiting for your approval of this exact restore.
                Keep this session open until it completes.
              </span>
              <a
                className="button small dark"
                href={approvalUrl}
                target="_blank"
                rel="noreferrer"
              >
                Review on Spacefast <ArrowUpRight size={14} />
              </a>
            </div>
          )}
          {demo && (
            <div className="demo-banner">
              <Sparkles size={16} />
              <span>
                <b>Real sites. Real history.</b> Two public Spacefast releases,
                captured {formatDate(demoSnapshot.capturedAt)}. Restore is
                disabled in this shared demo.
              </span>
              <button
                onClick={() => {
                  leaveDemo();
                  if (!account.connected) setModal("connect");
                }}
              >
                {account.connected
                  ? "Back to my Spaces"
                  : "Connect your account"}{" "}
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {!space && !loading ? (
            <>
              <section className="welcome-card">
                <div className="welcome-copy">
                  <div className="pill-label">
                    <span /> A HOME FOR EVERY VERSION
                  </div>
                  <h2>
                    Your next chapter
                    <br />
                    starts with a look back.
                  </h2>
                  <p>
                    Connect your Spacefast account to explore deployment
                    history, compare what changed, and return to a version you
                    love.
                  </p>
                  <div className="welcome-actions">
                    <button
                      className="button lime"
                      onClick={() => setModal("connect")}
                    >
                      <Link2 size={16} /> Connect Spacefast{" "}
                      <ArrowUpRight size={16} />
                    </button>
                    <button
                      className="button ghost-light"
                      onClick={() => explore()}
                    >
                      Try live demo <ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="welcome-trust">
                    <ShieldCheck size={14} /> Read-only by default{" "}
                    <span>·</span> No API key to paste
                  </div>
                </div>
                <div className="time-art" aria-hidden="true">
                  <div className="time-grid" />
                  <div className="time-ring ring-a" />
                  <div className="time-ring ring-b" />
                  <div className="time-ring ring-c" />
                  <div className="time-orbit-dot" />
                  <div className="floating-version fv-one">
                    <span className="tiny-dot" /> VERSION N <Check size={13} />
                  </div>
                  <div className="floating-version fv-two">
                    <History size={14} /> Your history, in orbit
                  </div>
                  <div className="time-clock">
                    <History size={74} strokeWidth={1} />
                  </div>
                  <div className="art-coordinate">
                    PAST ↔ PRESENT
                    <br />∞ POSSIBILITIES
                  </div>
                </div>
              </section>
              <div className="feature-grid">
                <article>
                  <span className="feature-icon lavender">
                    <History size={21} />
                  </span>
                  <h3>See the whole story</h3>
                  <p>
                    A browsable timeline of the real, immutable versions in your
                    Spaces.
                  </p>
                  <span>01 / EXPLORE</span>
                </article>
                <article>
                  <span className="feature-icon sage">
                    <SplitSquareHorizontal size={21} />
                  </span>
                  <h3>A fresh point of view</h3>
                  <p>
                    Put two versions side by side and spot the details that made
                    a difference.
                  </p>
                  <span>02 / COMPARE</span>
                </article>
                <article>
                  <span className="feature-icon sand">
                    <Undo2 size={21} />
                  </span>
                  <h3>A considered return</h3>
                  <p>
                    Restore a ready version with explicit access, a live check,
                    and your confirmation.
                  </p>
                  <span>03 / RESTORE</span>
                </article>
              </div>
              <section className="empty-timeline" id="timeline">
                <div className="section-heading">
                  <div>
                    <History size={17} />
                    <h2>Your timeline is waiting</h2>
                  </div>
                  <span className="mono">NO DEPLOYMENTS LOADED</span>
                </div>
                <div className="empty-track">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <p>
                  {account.connected
                    ? "Choose a Space from the sidebar or refine your search."
                    : "Connect an account or explore the demo to take your first trip."}
                </p>
              </section>
            </>
          ) : (
            <>
              <section className="space-overview">
                <div className="space-identity">
                  <div className="space-avatar">
                    <Globe2 size={25} />
                  </div>
                  <div>
                    <div className="identity-title">
                      <h2>{space?.title || "Loading Space…"}</h2>
                      {space && (
                        <Status
                          status={space.disabled ? "disabled" : space.status}
                        />
                      )}
                    </div>
                    <div className="space-url">
                      {space?.liveUrl ? (
                        <a
                          href={space.liveUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {new URL(space.liveUrl).hostname}
                          <ArrowUpRight size={13} />
                        </a>
                      ) : (
                        <span>
                          {demo
                            ? "Illustrative Space · no live site"
                            : "Live URL unavailable"}
                        </span>
                      )}
                      <span className="separator">/</span>
                      <GitBranch size={12} />
                      <span>live</span>
                    </div>
                  </div>
                </div>
                <div className="overview-actions">
                  <button
                    className="button small outline"
                    disabled={
                      !selected || !compared || selected.id === compared.id
                    }
                    onClick={() => {
                      setCopied(false);
                      setCopyError("");
                      setModal("share");
                    }}
                  >
                    <Link2 size={14} /> Share comparison
                  </button>
                  <button
                    className="button small outline"
                    disabled={!space}
                    onClick={() => setModal("activity")}
                  >
                    <History size={14} /> Restore activity
                  </button>
                  {pendingTicket && (
                    <button
                      className="button small outline"
                      onClick={checkRestore}
                    >
                      <RefreshCw size={14} /> Check restore status
                    </button>
                  )}
                  <button
                    className="button small outline"
                    onClick={() =>
                      demo
                        ? setNotice(
                            "This demo is a recorded snapshot of real deployments. Connect Spacefast to load your current history.",
                          )
                        : setRefreshKey((n) => n + 1)
                    }
                    disabled={loading}
                  >
                    <RefreshCw size={14} className={loading ? "spin" : ""} />{" "}
                    Refresh
                  </button>
                  {space?.liveUrl && (
                    <a
                      className="button small dark"
                      href={space.liveUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Visit live site <ArrowUpRight size={14} />
                    </a>
                  )}
                </div>
              </section>
              <section className="metrics" aria-label="Deployment summary">
                <div>
                  <span>VERSIONS LOADED</span>
                  <strong>
                    {versions.length.toString().padStart(2, "0")}
                    <small>
                      {versionPage.hasMore ? "more available" : "in this Space"}
                    </small>
                  </strong>
                </div>
                <div>
                  <span>CURRENTLY LIVE</span>
                  <strong>
                    {liveVersion ? versionLabel(liveVersion) : "—"}
                    <small>
                      {liveVersion
                        ? formatDate(liveVersion.createdAt)
                        : space?.liveVersionId
                          ? "not on this page"
                          : "no live version"}
                    </small>
                  </strong>
                </div>
                <div>
                  <span>READY TO REVISIT</span>
                  <strong>
                    {versions
                      .filter((v) => v.status === "ready")
                      .length.toString()
                      .padStart(2, "0")}
                    <small>ready versions loaded</small>
                  </strong>
                </div>
                <div>
                  <span>CONNECTION ACCESS</span>
                  <strong className="access-metric">
                    <ShieldCheck size={20} />
                    {demo
                      ? "Public demo"
                      : account.canRestore
                        ? "Restore"
                        : "Read only"}
                  </strong>
                  <small>
                    {demo
                      ? "No account actions"
                      : account.canRestore
                        ? "Confirmation required"
                        : "Your live site stays safe"}
                  </small>
                </div>
              </section>
              <div className="history-layout" id="timeline">
                <section className="timeline-panel">
                  <div className="section-heading">
                    <div>
                      <History size={18} />
                      <h2>Version history</h2>
                    </div>
                    <span className="count-badge">{versions.length}</span>
                  </div>
                  <div className="timeline-tools">
                    <label className="search-input">
                      <Search size={15} />
                      <input
                        aria-label="Search version history"
                        placeholder="Find a version…"
                        value={versionQuery}
                        onChange={(e) => setVersionQuery(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Filter versions by status"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">All statuses</option>
                      <option value="ready">Ready</option>
                      <option value="failed">Failed</option>
                      <option value="live">Live</option>
                      <option value="building">Building</option>
                      <option value="finalizing">Finalizing</option>
                    </select>
                  </div>
                  <div className="timeline-list" aria-label="Versions">
                    {loading && !versions.length ? (
                      <div className="list-empty">
                        <LoaderCircle className="spin" /> Loading version
                        history…
                      </div>
                    ) : visibleVersions.length ? (
                      visibleVersions.map((v, index) => (
                        <button
                          key={v.id}
                          className={`version-item ${v.id === selectedId ? "is-selected" : ""}`}
                          onClick={() => {
                            setSelectedId(v.id);
                            if (v.id === compareId)
                              setCompareId(
                                versions.find(
                                  (x) => x.status === "ready" && x.id !== v.id,
                                )?.id || "",
                              );
                          }}
                          aria-pressed={v.id === selectedId}
                        >
                          <div className="timeline-rail">
                            <span
                              className={`timeline-node ${v.status === "failed" ? "failed-node" : ""}`}
                            >
                              {v.id === space?.liveVersionId ? (
                                <Check size={11} />
                              ) : v.status === "failed" ? (
                                <X size={10} />
                              ) : null}
                            </span>
                            {index !== visibleVersions.length - 1 && (
                              <span className="rail-line" />
                            )}
                          </div>
                          <div className="version-main">
                            <div className="version-top">
                              <strong>{versionLabel(v)}</strong>
                              <Status
                                status={v.status}
                                live={v.id === space?.liveVersionId}
                              />
                              <span className="version-time">
                                {formatDate(v.createdAt)}
                              </span>
                            </div>
                            <p>
                              {v.message ||
                                v.failureMessage ||
                                "Deployment version"}
                            </p>
                            <div className="version-meta">
                              <Clock3 size={11} />
                              {formatTime(v.createdAt)}
                              <span>·</span>
                              {v.branch ? (
                                <>
                                  <GitBranch size={11} />
                                  {v.branch}
                                </>
                              ) : (
                                v.publisher || "Direct publish"
                              )}
                              {v.id === selectedId && (
                                <ArrowRight size={13} className="push" />
                              )}
                            </div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="list-empty">
                        No versions match this filter.
                      </div>
                    )}
                  </div>
                  {versionPage.hasMore && (
                    <button
                      className="load-more"
                      onClick={moreVersions}
                      disabled={loading}
                    >
                      {loading ? "Loading…" : "Load earlier versions"}
                      <ArrowDown size={14} />
                    </button>
                  )}
                  <div className="timeline-bottom">
                    <LockKeyhole size={12} /> Immutable versions. Original
                    history preserved.
                  </div>
                </section>
                <section className="inspector">
                  <div className="inspector-head">
                    <div
                      className="inspector-tabs"
                      role="tablist"
                      aria-label="Version view"
                      onKeyDown={(event) => {
                        if (
                          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                            event.key,
                          )
                        )
                          return;
                        event.preventDefault();
                        const tabs: ComparisonView[] = [
                          "preview",
                          "files",
                          "details",
                        ];
                        const next =
                          event.key === "Home"
                            ? tabs[0]
                            : event.key === "End"
                              ? tabs[2]
                              : tabs[
                                  (tabs.indexOf(tab) +
                                    (event.key === "ArrowRight" ? 1 : 2)) %
                                    3
                                ];
                        setTab(next);
                        document.getElementById(`${next}-tab`)?.focus();
                      }}
                    >
                      <button
                        role="tab"
                        id="preview-tab"
                        aria-selected={tab === "preview"}
                        aria-controls="inspector-body"
                        tabIndex={tab === "preview" ? 0 : -1}
                        onClick={() => setTab("preview")}
                      >
                        <SplitSquareHorizontal size={15} /> Compare
                      </button>
                      <button
                        role="tab"
                        id="files-tab"
                        tabIndex={tab === "files" ? 0 : -1}
                        aria-selected={tab === "files"}
                        aria-controls="inspector-body"
                        onClick={() => setTab("files")}
                      >
                        <FileDiff size={15} /> Files
                      </button>
                      <button
                        role="tab"
                        id="details-tab"
                        tabIndex={tab === "details" ? 0 : -1}
                        aria-selected={tab === "details"}
                        aria-controls="inspector-body"
                        onClick={() => setTab("details")}
                      >
                        <Terminal size={15} /> Details
                      </button>
                    </div>
                    {tab === "preview" && (
                      <div
                        className="device-controls"
                        aria-label="Preview viewport"
                      >
                        <button
                          className={mobile ? "" : "chosen"}
                          aria-label="Desktop preview"
                          aria-pressed={!mobile}
                          onClick={() => setMobile(false)}
                        >
                          <Monitor size={16} />
                        </button>
                        <button
                          className={mobile ? "chosen" : ""}
                          aria-label="Mobile preview"
                          aria-pressed={mobile}
                          onClick={() => setMobile(true)}
                        >
                          <Smartphone size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div
                    id="inspector-body"
                    role="tabpanel"
                    aria-labelledby={`${tab}-tab`}
                  >
                    {tab === "preview" ? (
                      <>
                        <div className="compare-toolbar">
                          <div>
                            <span className="eyebrow">
                              A DIFFERENT POINT IN TIME
                            </span>
                            <h3>
                              {selected
                                ? `${versionLabel(selected)} meets ${compared ? versionLabel(compared) : "another version"}`
                                : "Select a version"}
                            </h3>
                          </div>
                          <span className="compare-label">
                            <span /> SIDE BY SIDE
                          </span>
                        </div>
                        <div className="preview-grid">
                          {[selected, compared].map((v, i) => (
                            <article className="preview-pane" key={i}>
                              <div className="preview-pane-heading">
                                <div>
                                  <span
                                    className={`pane-dot ${i ? "purple" : ""}`}
                                  />
                                  {i === 0 ? (
                                    <strong>
                                      {v ? versionLabel(v) : "Selected version"}
                                    </strong>
                                  ) : (
                                    <select
                                      aria-label="Compare with version"
                                      value={compareId}
                                      onChange={(e) =>
                                        setCompareId(e.target.value)
                                      }
                                    >
                                      <option value="">Choose a version</option>
                                      {versions
                                        .filter((x) => x.id !== selectedId)
                                        .map((x) => (
                                          <option key={x.id} value={x.id}>
                                            {versionLabel(x)} · {x.status}
                                          </option>
                                        ))}
                                    </select>
                                  )}
                                  {v?.id === space?.liveVersionId && (
                                    <span className="live-tiny">LIVE</span>
                                  )}
                                </div>
                                {v?.immutableUrl && (
                                  <a
                                    href={v.immutableUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="icon-btn"
                                    aria-label={`Open ${versionLabel(v)} in new tab`}
                                  >
                                    <ArrowUpRight size={15} />
                                  </a>
                                )}
                              </div>
                              <div className="browser-bar">
                                <div>
                                  <i />
                                  <i />
                                  <i />
                                </div>
                                <LockKeyhole size={10} />
                                <span>
                                  {demo
                                    ? `tm-orbital-lab-1015 / ${v ? versionLabel(v) : "—"}`
                                    : v?.immutableUrl
                                      ? new URL(v.immutableUrl).hostname
                                      : "Version URL unavailable"}
                                </span>
                              </div>
                              <Preview
                                version={v}
                                demo={demo}
                                mobile={mobile}
                              />
                              <div className="preview-foot">
                                <span>
                                  {v
                                    ? formatDate(v.createdAt)
                                    : "No version selected"}
                                </span>
                                <span>{v?.fileCount ?? "—"} files</span>
                              </div>
                            </article>
                          ))}
                        </div>
                        <div className="compare-note">
                          <Info size={14} />
                          {demo
                            ? "These are real, public Spacefast deployments. This shared demo uses a recorded history snapshot and never changes a live site."
                            : "Previews use immutable version links. Secure sessions are available for private versions; site policies can still limit embedding."}
                        </div>
                      </>
                    ) : tab === "files" ? (
                      <>
                        <div className="file-pair-picker">
                          <label>
                            Compare from{" "}
                            <select
                              aria-label="Compare files from version"
                              value={compareId}
                              onChange={(e) => setCompareId(e.target.value)}
                            >
                              <option value="">Choose a version</option>
                              {versions
                                .filter(
                                  (v) =>
                                    v.status === "ready" && v.id !== selectedId,
                                )
                                .map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {versionLabel(v)}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <span>
                            to{" "}
                            {selected
                              ? versionLabel(selected)
                              : "selected version"}
                          </span>
                        </div>
                        <Suspense
                          fallback={
                            <p className="changes-loading" role="status">
                              Loading file comparison…
                            </p>
                          }
                        >
                          <Changes
                            spaceId={spaceId}
                            base={compared}
                            target={selected}
                            demo={demo}
                          />
                        </Suspense>
                      </>
                    ) : (
                      <div className="details-view">
                        <div className="eyebrow">VERSION DETAILS</div>
                        <h3>
                          {selected
                            ? versionLabel(selected)
                            : "No version selected"}
                        </h3>
                        {selected && (
                          <>
                            <Status
                              status={selected.status}
                              live={selected.id === space?.liveVersionId}
                            />
                            <dl>
                              <div>
                                <dt>Version ID</dt>
                                <dd>{selected.id}</dd>
                              </div>
                              <div>
                                <dt>Created</dt>
                                <dd>
                                  {new Date(
                                    selected.createdAt,
                                  ).toLocaleString()}
                                </dd>
                              </div>
                              <div>
                                <dt>Publisher</dt>
                                <dd>{selected.publisher || "Unavailable"}</dd>
                              </div>
                              <div>
                                <dt>Commit</dt>
                                <dd>
                                  {selected.gitCommitSha ||
                                    "Unavailable · direct upload or no provenance"}
                                </dd>
                              </div>
                              <div>
                                <dt>Files</dt>
                                <dd>{selected.fileCount ?? "Unavailable"}</dd>
                              </div>
                              <div>
                                <dt>Total size</dt>
                                <dd>{bytes(selected.totalBytes)}</dd>
                              </div>
                              <div>
                                <dt>Changes</dt>
                                <dd>
                                  +{selected.filesAddedCount ?? "—"} added ·{" "}
                                  {selected.filesChangedCount ?? "—"} changed ·{" "}
                                  {selected.filesRemovedCount ?? "—"} removed
                                </dd>
                              </div>
                              <div>
                                <dt>Version link</dt>
                                <dd>
                                  {selected.immutableUrl ? (
                                    <a
                                      href={selected.immutableUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Open immutable version{" "}
                                      <ExternalLink size={13} />
                                    </a>
                                  ) : (
                                    "Unavailable"
                                  )}
                                </dd>
                              </div>
                            </dl>
                            {selected.failureMessage && (
                              <div className="alert error">
                                {selected.failureMessage}
                              </div>
                            )}
                            <p className="muted">
                              Versions are deployment snapshots. Spacefast does
                              not expose a historical database snapshot or a
                              complete per-user browsing state through this
                              integration.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="restore-bar">
                    <div>
                      <Undo2 size={18} />
                      <span>
                        <strong>
                          {selected?.id === space?.liveVersionId
                            ? "You’re looking at the live version"
                            : "Found the version you’re looking for?"}
                        </strong>
                        <small>
                          {demo
                            ? "Restore is unavailable in the demo workspace."
                            : !account.canRestore
                              ? "Read-only connection. Restore access is optional."
                              : selected?.status !== "ready"
                                ? "Only ready versions can be promoted."
                                : "Review the live change before you confirm."}
                        </small>
                      </span>
                    </div>
                    <button
                      className="button small dark"
                      onClick={
                        account.canRestore
                          ? prepareRestore
                          : () => {
                              setRestoreAccess(true);
                              setModal("connect");
                            }
                      }
                      disabled={
                        demo ||
                        !selected ||
                        selected.status !== "ready" ||
                        selected.id === space?.liveVersionId ||
                        !!pendingTicket ||
                        busy ||
                        !!space?.disabled
                      }
                    >
                      {!account.canRestore && !demo ? (
                        <LockKeyhole size={14} />
                      ) : (
                        <Undo2 size={14} />
                      )}{" "}
                      Restore version
                    </button>
                  </div>
                </section>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              <span className="footer-spark">✦</span> A little less “what if.” A
              little more “go back.”
            </span>
            <button onClick={() => setModal("capabilities")}>
              Built with honest limits <ArrowUpRight size={13} />
            </button>
            <span className="mono">POWERED BY SPACEFAST</span>
          </footer>
        </main>
      </div>
      {modal === "connect" && (
        <Dialog title="Connect your Spacefast" close={() => setModal(null)}>
          <div className="dialog-illustration">
            <Link2 size={28} />
            <span>↔</span>
            <History size={28} />
          </div>
          <p>
            Travel through your real deployment history. Sign in on Spacefast’s
            own authorization page; your credentials stay on the server.
          </p>
          <div className="access-choice">
            <label>
              <input
                type="checkbox"
                checked={restoreAccess}
                onChange={(e) => setRestoreAccess(e.target.checked)}
              />
              <span>
                <b>Allow restoring versions</b>
                <small>
                  Requests publish access in addition to read access. Each
                  restore still requires explicit confirmation.
                </small>
              </span>
            </label>
          </div>
          <div className="scope-box">
            <ShieldCheck size={17} />
            <span>
              {restoreAccess
                ? "Read Spaces, teams, versions, and publish versions"
                : "Read Spaces, teams, versions, and preview files"}
            </span>
          </div>
          {connectionError && (
            <p className="alert error" role="alert">
              {connectionError}
            </p>
          )}
          <form
            method="POST"
            action="/api/auth/start"
            onSubmit={async (event) => {
              event.preventDefault();
              setConnecting(true);
              setConnectionError("");
              try {
                const response = await fetch("/api/auth/start", {
                  method: "POST",
                  body: new URLSearchParams({
                    access: restoreAccess ? "restore" : "read",
                    returnTo: location.pathname + location.search,
                  }),
                  credentials: "same-origin",
                  headers: { Accept: "application/json" },
                });
                const result = await response.json();
                if (!response.ok)
                  throw new Error(
                    result.error || "Spacefast sign-in could not start.",
                  );
                const target = new URL(result.authorizationUrl);
                if (
                  target.origin !== "https://api.spacefast.com" ||
                  target.pathname !== "/v1/auth/oauth2/authorize"
                )
                  throw new Error(
                    "Spacefast returned an unexpected sign-in destination.",
                  );
                location.assign(target.href);
              } catch (error) {
                setConnectionError((error as Error).message);
                setConnecting(false);
              }
            }}
          >
            <input
              type="hidden"
              name="access"
              value={restoreAccess ? "restore" : "read"}
            />
            <button
              className="button dark wide"
              type="submit"
              disabled={connecting}
            >
              {connecting ? "Opening Spacefast…" : "Continue to Spacefast"}{" "}
              <ArrowUpRight size={16} />
            </button>
          </form>
          <p className="dialog-fine">
            You’ll approve access on Spacefast. Read access is the default;
            restoring is optional and always requires a separate confirmation.
            You can disconnect from this app at any time.
          </p>
          <button
            className="text-button"
            onClick={() => {
              setModal(null);
              explore();
            }}
          >
            Try the live demo first <ArrowRight size={14} />
          </button>
        </Dialog>
      )}
      {modal === "share" && selected && compared && (
        <Dialog title="Share this comparison" close={() => setModal(null)}>
          <p>
            This link opens {space?.title}, {versionLabel(compared)} →{" "}
            {versionLabel(selected)}, in the current view.
          </p>
          <label className="share-link-field">
            Comparison link
            <input
              readOnly
              aria-label="Comparison link"
              value={
                location.origin +
                comparisonPath({
                  demo,
                  spaceId,
                  versionId: selected.id,
                  compareId: compared.id,
                  view: tab,
                })
              }
              onClick={(e) => e.currentTarget.select()}
            />
          </label>
          <button
            className="button dark wide"
            onClick={async () => {
              try {
                if (!navigator.clipboard) throw new Error();
                await navigator.clipboard.writeText(
                  location.origin +
                    comparisonPath({
                      demo,
                      spaceId,
                      versionId: selected.id,
                      compareId: compared.id,
                      view: tab,
                    }),
                );
                setCopied(true);
                setCopyError("");
              } catch {
                setCopyError(
                  "Clipboard unavailable. Select the link above and copy it manually.",
                );
              }
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
            {copied ? "Copied" : "Copy comparison link"}
          </button>
          <p className="share-permission">
            {demo
              ? "This public demo can be viewed without signing in."
              : "The link does not grant access. Viewers must sign in and have permission to view both versions."}
          </p>
          <p role="status">
            {copyError || (copied ? "Link copied to your clipboard." : "")}
          </p>
        </Dialog>
      )}
      {modal === "activity" && (
        <Dialog title="Restore activity" close={() => setModal(null)}>
          <h3 className="activity-space">{space?.title}</h3>
          <RestoreActivity
            spaceId={spaceId}
            demo={demo}
            versions={versions}
            revision={refreshKey}
          />
        </Dialog>
      )}
      {modal === "capabilities" && (
        <Dialog title="Built with honest limits" close={() => setModal(null)}>
          <p>
            This app uses Spacefast’s documented v1 API and the OAuth
            capabilities advertised by its live authorization server.
          </p>
          <div className="capability-list">
            {[
              [
                "Spaces & history",
                "Available",
                "Paginated Spaces and immutable version history.",
              ],
              [
                "Side-by-side preview",
                "Conditional",
                "Short-lived version preview sessions; permissions, browser cookies, and site policies can limit embedding.",
              ],
              [
                "Restore to live",
                "Conditional",
                "Ready-version promotion requires publish access and your confirmation. Spacefast may also require its own approval; the app resumes the exact approved request securely. Success requires the target version to be live.",
              ],
              [
                "Atomic restore lock",
                "Unavailable",
                "The documented promotion endpoint has no compare-and-swap condition.",
              ],
              [
                "Additional channels",
                "Unavailable",
                "Only the live channel is currently supported.",
              ],
              [
                "Database time travel",
                "Unavailable",
                "A version restore is not a database backup restore.",
              ],
            ].map(([name, status, description]) => (
              <div key={name}>
                <div>
                  <b>{name}</b>
                  <span
                    className={
                      status === "Available"
                        ? "available"
                        : status === "Unavailable"
                          ? "unavailable"
                          : "conditional"
                    }
                  >
                    {status}
                  </span>
                </div>
                <p>{description}</p>
              </div>
            ))}
          </div>
          <a
            className="button outline wide"
            href="https://spacefast.com/docs/api/reference/"
            target="_blank"
            rel="noreferrer"
          >
            Read the official API reference <ExternalLink size={15} />
          </a>
        </Dialog>
      )}
      {modal === "restore" && (
        <Dialog
          title="Restore this version?"
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          <div className="restore-warning">
            <Undo2 size={23} />
            <span>This changes what visitors see on your live site.</span>
          </div>
          {busy && !restore ? (
            <p role="status">
              <LoaderCircle className="spin" size={18} /> Checking the current
              live deployment…
            </p>
          ) : (
            restore && (
              <>
                <p>
                  Promote <strong>{versionLabel(restore.target)}</strong> to the{" "}
                  <strong>live</strong> channel for{" "}
                  <strong>{restore.slug}</strong>. The current version remains
                  in history.
                </p>
                <p className="dialog-fine">
                  {restore.warning} This confirmation expires after two minutes.
                </p>
                <label className="confirm-label">
                  Type <strong>{restore.slug}</strong> to confirm
                  <input
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    aria-label="Confirm Space slug"
                    placeholder={restore.slug}
                  />
                </label>
                <button
                  className="button dark wide"
                  disabled={
                    confirmation !== restore.slug || busy || !!pendingTicket
                  }
                  onClick={confirmRestore}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Undo2 size={16} />
                  )}{" "}
                  Confirm restore to live
                </button>
              </>
            )
          )}
          {restoreError && (
            <div className="alert error" role="alert">
              {restoreError}
            </div>
          )}
          <button
            className="text-button"
            onClick={() => setModal(null)}
            disabled={busy}
          >
            Keep the current deployment
          </button>
        </Dialog>
      )}
    </div>
  );
}
