import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCheck,
  Clock3,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { api } from "./api";
import type { Page, RestoreEvent, Version } from "./types";
const names: Record<string, string> = {
  verified: "Verified live",
  failed: "Failed",
  rejected: "Rejected",
  awaiting_approval: "Awaiting your approval",
  approved: "Approved",
  resuming: "Executing approved restore",
  submitting: "Submitting",
  submitted: "Checking live deployment",
  uncertain: "Outcome unverified",
  approval_only: "Unavailable",
};
export function RestoreActivity({
  spaceId,
  demo,
  versions,
  revision,
}: {
  spaceId: string;
  demo: boolean;
  versions: Version[];
  revision: number;
}) {
  const [reload, setReload] = useState(0);
  const [events, setEvents] = useState<RestoreEvent[]>([]),
    [page, setPage] = useState<Page>({ hasMore: false, nextCursor: null }),
    [loading, setLoading] = useState(!demo),
    [error, setError] = useState("");
  useEffect(() => {
    if (demo) return;
    const c = new AbortController();
    setLoading(true);
    setError("");
    api<{ data: RestoreEvent[]; pagination: Page }>(
      `/restore/activity?spaceId=${encodeURIComponent(spaceId)}`,
      undefined,
      c.signal,
    )
      .then((r) => {
        setEvents(r.data);
        setPage(r.pagination);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [spaceId, demo, revision, reload]);
  const label = (id: string) => {
    const v = versions.find((v) => v.id === id);
    return v?.number != null ? `v${v.number}` : id.slice(0, 16);
  };
  async function more() {
    setLoading(true);
    try {
      const r = await api<{ data: RestoreEvent[]; pagination: Page }>(
        `/restore/activity?spaceId=${encodeURIComponent(spaceId)}&cursor=${encodeURIComponent(page.nextCursor || "")}`,
      );
      setEvents((v) => [...v, ...r.data]);
      setPage(r.pagination);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="restore-activity">
      <p>
        Your restores requested through this app for this Space. External
        publishes and dashboard actions are not included.
      </p>
      {demo ? (
        <div className="activity-empty">
          <Clock3 size={24} />
          <h3>The shared demo never changes a live site</h3>
          <p>Connect your account to see your own restore activity.</p>
        </div>
      ) : (
        <>
          <button
            className="button small outline"
            disabled={loading}
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCw size={14} /> Refresh activity
          </button>
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {events.length === 0 && !loading && !error && (
            <div className="activity-empty">
              <Clock3 size={24} />
              <h3>No restores recorded yet</h3>
              <p>
                Confirmed attempts will appear here, including pending and
                unsuccessful outcomes.
              </p>
            </div>
          )}
          <ol className="activity-list">
            {events.map((e) => (
              <li key={e.id}>
                <div
                  className={`activity-icon ${e.state === "verified" ? "verified" : ""}`}
                >
                  {e.state === "verified" ? (
                    <CheckCheck size={17} />
                  ) : (
                    <Clock3 size={17} />
                  )}
                </div>
                <div>
                  <div className="activity-pair">
                    <strong title={e.fromVersionId}>
                      {label(e.fromVersionId)}
                    </strong>
                    <ArrowRight size={14} />
                    <strong title={e.toVersionId}>
                      {label(e.toVersionId)}
                    </strong>
                  </div>
                  <b className="activity-state">
                    {names[e.state] || "Status unavailable"}
                  </b>
                  <p>
                    Requested{" "}
                    <time dateTime={e.createdAt}>
                      {new Date(e.createdAt).toLocaleString()}
                    </time>
                  </p>
                  {e.finishedAt ? (
                    <p>
                      {e.state === "verified" ? "Verified" : "Finished"}{" "}
                      <time dateTime={e.finishedAt}>
                        {new Date(e.finishedAt).toLocaleString()}
                      </time>
                    </p>
                  ) : (
                    e.state === "verified" && (
                      <p>
                        Completion time unavailable for this earlier record.
                      </p>
                    )
                  )}
                </div>
              </li>
            ))}
          </ol>
          {loading && (
            <p role="status" className="changes-loading">
              <LoaderCircle size={16} className="spin" /> Loading restore
              activity…
            </p>
          )}
          {page.hasMore && (
            <button
              className="button outline wide"
              disabled={loading}
              onClick={more}
            >
              Load earlier activity
            </button>
          )}
        </>
      )}
    </div>
  );
}
