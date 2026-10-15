// Runs exclusively in Spacefast Functions. Never import this module in src/.
export const API = "https://api.spacefast.com";
export const ISSUER = `${API}/v1/auth`;
const COOKIE = "__Host-tm";
const SESSION_MS = 8 * 60 * 60 * 1000;
interface Result {
  results?: Record<string, any>[];
  meta?: { changes?: number };
  changes?: number;
}
interface Statement {
  bind(...args: unknown[]): Statement;
  all(): Promise<Result>;
  run(): Promise<Result>;
}
export interface Env {
  DB?: { prepare(sql: string): Statement };
  APP_ORIGIN?: string;
  TM_OAUTH_CLIENT_ID?: string;
}
type Session = {
  state?: string;
  verifier?: string;
  requestedScopes?: string;
  clientId?: string;
  pendingUntil?: number;
  accessToken?: string;
  expiresAt?: number;
  scope?: string;
  restore?: boolean;
  ownerId?: string;
  action?: ProviderAction;
  returnTo?: string;
};
type ProviderAction = {
  token: string;
  url: string;
  expiresAt: string;
  interval: number;
  approved?: boolean;
  failureCode?: string;
};
class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public action?: ProviderAction,
  ) {
    super(message);
  }
}
const encoder = new TextEncoder();
export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unbase64 = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async (text: string) =>
  base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))),
  );
async function keyFor(id: string) {
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", encoder.encode(`tm-v1:${id}`)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(id: string, data: Session) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await keyFor(id),
    encoder.encode(JSON.stringify(data)),
  );
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}
export async function unseal(id: string, data: string): Promise<Session> {
  const [iv, ciphertext] = data.split(".");
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unbase64(iv) },
        await keyFor(id),
        unbase64(ciphertext),
      ),
    ),
  );
}
function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...extra,
    },
  });
}
const sessionCookie = (id: string, maxAge = 8 * 60 * 60) =>
  `${COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
function cookieId(request: Request) {
  const id = request.headers
    .get("Cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return id && /^[A-Za-z0-9_-]{43}$/.test(id) ? id : null;
}
function db(env: Env) {
  if (!env.DB)
    throw new AppError(
      503,
      "runtime_unavailable",
      "Account connections require the deployed Spacefast Functions database. Local preview supports the sample workspace.",
    );
  return env.DB;
}
async function init(env: Env) {
  await db(env)
    .prepare(
      "CREATE TABLE IF NOT EXISTS tm_restore_activity (id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(64) NOT NULL, space_id VARCHAR(128) NOT NULL, slug VARCHAR(255) NOT NULL, from_version VARCHAR(128) NOT NULL, to_version VARCHAR(128) NOT NULL, state VARCHAR(32) NOT NULL, operation_id VARCHAR(128), operation_status VARCHAR(64), created_at DOUBLE NOT NULL, updated_at DOUBLE NOT NULL, finished_at DOUBLE)",
    )
    .run();
  await db(env)
    .prepare(
      "CREATE TABLE IF NOT EXISTS tm_sessions (id VARCHAR(64) PRIMARY KEY, payload TEXT NOT NULL, expires_at DOUBLE NOT NULL)",
    )
    .run();
  await db(env)
    .prepare(
      "CREATE TABLE IF NOT EXISTS tm_restores (id VARCHAR(64) PRIMARY KEY, session_id VARCHAR(64) NOT NULL, space_id VARCHAR(128) NOT NULL, version_id VARCHAR(128) NOT NULL, expected_live VARCHAR(128) NOT NULL, slug VARCHAR(255) NOT NULL, expires_at DOUBLE NOT NULL, state VARCHAR(32) NOT NULL, operation_id VARCHAR(128))",
    )
    .run();
  await db(env)
    .prepare(
      "CREATE TABLE IF NOT EXISTS tm_restore_guards (space_id VARCHAR(128) PRIMARY KEY, ticket_id VARCHAR(64) NOT NULL UNIQUE, owner_id VARCHAR(64) NOT NULL)",
    )
    .run();
  await db(env)
    .prepare(
      "CREATE TABLE IF NOT EXISTS tm_restore_actions (ticket_id VARCHAR(64) PRIMARY KEY, session_id VARCHAR(64) NOT NULL, payload TEXT NOT NULL, next_poll_at DOUBLE NOT NULL)",
    )
    .run();
}
async function recordActivity(
  env: Env,
  ticket: string,
  state: string,
  operationId: string | null = null,
  operationStatus: string | null = null,
) {
  await db(env)
    .prepare(
      "UPDATE tm_restore_activity SET state = ?, operation_id = COALESCE(?, operation_id), operation_status = ?, updated_at = ?, finished_at = COALESCE(finished_at, ?) WHERE id = ?",
    )
    .bind(
      state,
      operationId,
      operationStatus,
      Date.now(),
      ["verified", "failed", "rejected"].includes(state) ? Date.now() : null,
      ticket,
    )
    .run();
}
async function recoverSessionActivity(env: Env, id: string, ownerId: string) {
  // The encrypted session already established this owner. Recover metadata
  // before rotating its cookie, even when its access token has expired.
  // Completion timestamps absent from these older records remain unavailable.
  await db(env)
    .prepare(
      "INSERT INTO tm_restore_activity (id, owner_id, space_id, slug, from_version, to_version, state, operation_id, operation_status, created_at, updated_at, finished_at) SELECT r.id, ?, r.space_id, r.slug, r.expected_live, r.version_id, r.state, r.operation_id, NULL, r.expires_at - 120000, r.expires_at - 120000, NULL FROM tm_restores r WHERE r.session_id = ? AND r.state <> 'prepared' AND NOT EXISTS (SELECT 1 FROM tm_restore_activity a WHERE a.id = r.id)",
    )
    .bind(ownerId, await digest(id))
    .run();
}
function returnPath(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 1200 ||
    !value.startsWith("/?")
  )
    return "/";
  const url = new URL(value, "https://return.invalid");
  if (
    url.origin !== "https://return.invalid" ||
    url.pathname !== "/" ||
    url.hash
  )
    return "/";
  const params = new URLSearchParams();
  for (const key of ["space", "version", "compare"]) {
    const value = url.searchParams.get(key);
    if (value && /^[A-Za-z0-9_-]{1,128}$/.test(value)) params.set(key, value);
  }
  const view = url.searchParams.get("view");
  if (["preview", "files", "details"].includes(view || ""))
    params.set("view", view!);
  if (url.searchParams.get("demo") === "1") params.set("demo", "1");
  return params.size ? `/?${params}` : "/";
}
async function save(env: Env, id: string, value: Session) {
  const hashed = await digest(id),
    payload = await seal(id, value);
  const existing = await db(env)
    .prepare("SELECT id FROM tm_sessions WHERE id = ?")
    .bind(hashed)
    .all();
  if (existing.results?.length)
    await db(env)
      .prepare(
        "UPDATE tm_sessions SET payload = ?, expires_at = ? WHERE id = ?",
      )
      .bind(payload, Date.now() + SESSION_MS, hashed)
      .run();
  else
    await db(env)
      .prepare(
        "INSERT INTO tm_sessions (id, payload, expires_at) VALUES (?, ?, ?)",
      )
      .bind(hashed, payload, Date.now() + SESSION_MS)
      .run();
}
async function load(env: Env, id: string | null): Promise<Session | null> {
  if (!id || !env.DB) return null;
  await init(env);
  const rows = await db(env)
    .prepare("SELECT payload FROM tm_sessions WHERE id = ? AND expires_at > ?")
    .bind(await digest(id), Date.now())
    .all();
  if (!rows.results?.[0]) return null;
  try {
    return await unseal(id, String(rows.results[0].payload));
  } catch {
    return null;
  }
}
export async function upstream(
  path: string,
  token?: string,
  options: RequestInit = {},
) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    redirect: "manual",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status >= 300 && response.status < 400)
    throw new AppError(
      502,
      "provider_redirect_rejected",
      "Spacefast unexpectedly redirected an API request. No credentials were forwarded.",
    );
  const body = (await response.json()) as any;
  const candidate =
    body.requiresAction ||
    body.details?.requiresAction ||
    (body.code === "confirmation_required" ? body.details : null);
  let action: ProviderAction | undefined;
  if (
    candidate &&
    typeof candidate.continuationToken === "string" &&
    candidate.continuationToken.length <= 4096 &&
    typeof candidate.url === "string"
  ) {
    const approvalUrl = safeUrl(candidate.url);
    const pollUrl = candidate.pollUrl;
    if (
      approvalUrl &&
      ["https://my.spacefast.com", "https://spacefast.com", API].includes(
        new URL(approvalUrl).origin,
      ) &&
      !approvalUrl.includes(candidate.continuationToken) &&
      (!pollUrl ||
        pollUrl === `${API}/v1/actions/resume` ||
        pollUrl === "/v1/actions/resume") &&
      Number.isFinite(Date.parse(candidate.expiresAt))
    )
      action = {
        token: candidate.continuationToken,
        url: approvalUrl,
        expiresAt: candidate.expiresAt,
        interval: Math.max(
          5,
          Number.isFinite(Number(candidate.pollAfterSeconds))
            ? Number(candidate.pollAfterSeconds)
            : 5,
        ),
      };
  }
  if (
    action ||
    body.requiresAction?.actionType === "confirmation" ||
    body.requiresAction?.actionType === "elevation"
  )
    throw new AppError(
      409,
      "provider_approval_required",
      "Spacefast requires a separate approval in its dashboard. This restore remains unresolved until its live status can be verified; another submission is blocked.",
      undefined,
      action,
    );
  if (!response.ok) {
    // Deliberately do not relay upstream messages, headers, or bodies containing credentials.
    const code =
      typeof body.code === "string" ? body.code : `provider_${response.status}`;
    const message = [
      "confirmation_required",
      "confirmation_token_required",
      "elevation_required",
    ].includes(code)
      ? "Restore unavailable until Spacefast’s own approval requirement is resolved. No successful restore has been reported. Review the pending action in Spacefast before trying again."
      : response.status === 401
        ? "Your Spacefast connection expired. Please reconnect."
        : response.status === 403
          ? "Unavailable: Spacefast did not grant this account permission for that action."
          : response.status === 429
            ? "Spacefast is rate limiting requests. Wait a moment before trying again."
            : "Spacefast could not complete the request. Retry after checking the deployment status.";
    throw new AppError(
      response.status,
      code,
      message,
      response.headers.get("X-Request-Id") ?? undefined,
    );
  }
  return body;
}
const safeUrl = (value: unknown): string | null => {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};
export function spaceView(s: any) {
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    status: s.status,
    disabled: !!s.disabled,
    liveUrl: safeUrl(s.liveUrl),
    liveVersionId: s.channels?.live?.versionId ?? null,
    updatedAt: s.updatedAt,
    teamSlug: s.teamSlug,
    operation: s.operation
      ? { id: s.operation.id, status: s.operation.status }
      : null,
  };
}
export function versionView(v: any) {
  return {
    id: v.id,
    spaceId: v.spaceId,
    number: v.number,
    status: v.status,
    immutableUrl: safeUrl(v.immutableUrl),
    immutableUrlStatus: v.immutableUrlStatus,
    isCurrentProduction: v.isCurrentProduction,
    createdAt: v.createdAt,
    readyAt: v.readyAt,
    fileCount: v.fileCount,
    totalBytes: v.totalBytes,
    gitCommitSha: v.gitCommitSha,
    message: v.source?.message ?? null,
    branch: v.source?.branch ?? null,
    publisher: v.publisher?.displayName ?? null,
    failureCode: v.failureCode,
    failureMessage: v.failureMessage,
    filesAddedCount: v.filesAddedCount,
    filesChangedCount: v.filesChangedCount,
    filesRemovedCount: v.filesRemovedCount,
  };
}
function validId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new AppError(
      400,
      "invalid_id",
      "A valid Space or version ID is required.",
    );
  return encodeURIComponent(value);
}
function pagination(value: any) {
  return {
    hasMore: value?.hasMore === true,
    nextCursor: typeof value?.nextCursor === "string" ? value.nextCursor : null,
  };
}
function originCheck(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    throw new AppError(
      403,
      "origin_rejected",
      "This action must be initiated from this app.",
    );
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none")
    throw new AppError(
      403,
      "origin_rejected",
      "Cross-site actions are blocked.",
    );
}
function redirect(location: string, cookie?: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
}
async function ownerFor(env: Env, id: string, session: Session) {
  if (session.ownerId) return session.ownerId;
  const me = (await upstream("/v1/me", session.accessToken)).data;
  if (typeof me?.user?.id !== "string")
    throw new AppError(
      502,
      "identity_unavailable",
      "Spacefast did not return a stable account identity. Restore is unavailable.",
    );
  session.ownerId = await digest(`owner:${me.user.id}`);
  await save(env, id, session);
  return session.ownerId;
}
async function ticketFor(
  env: Env,
  id: string,
  ticket: string,
  ownerId?: string,
) {
  validId(ticket);
  const result = await db(env)
    .prepare(
      "SELECT r.* FROM tm_restores r LEFT JOIN tm_restore_guards g ON g.ticket_id = r.id WHERE r.id = ? AND (r.session_id = ? OR g.owner_id = ?)",
    )
    .bind(ticket, await digest(id), ownerId || "")
    .all();
  const row = result.results?.[0];
  if (!row)
    throw new AppError(
      404,
      "ticket_unavailable",
      "This restore confirmation is no longer available.",
    );
  return row;
}
async function executeApprovedRestore(
  env: Env,
  ticket: Record<string, any>,
  token: string,
  sessionId: string,
  action: ProviderAction,
) {
  const lock = await db(env)
    .prepare("UPDATE tm_restores SET state = ? WHERE id = ? AND state = ?")
    .bind("resuming", ticket.id, "approved")
    .run();
  if ((lock.meta?.changes ?? lock.changes) !== 1) return;
  ticket.state = "resuming";
  try {
    if (Date.parse(action.expiresAt) <= Date.now())
      throw new AppError(
        410,
        "confirmation_expired",
        "The approved action expired before execution.",
      );
    const space = (
      await upstream(`/v1/spaces/${validId(ticket.space_id)}`, token)
    ).data;
    const version = (
      await upstream(
        `/v1/spaces/${validId(ticket.space_id)}/versions/${validId(ticket.version_id)}`,
        token,
      )
    ).data;
    if (
      space.channels?.live?.versionId !== ticket.expected_live ||
      space.disabled ||
      space.status !== "active" ||
      ["queued", "running"].includes(space.operation?.status) ||
      version.status !== "ready"
    ) {
      throw new AppError(
        409,
        "live_changed",
        "The deployment changed while approval was pending. Review a new confirmation.",
      );
    }
    const result = await upstream(
      `/v1/spaces/${validId(ticket.space_id)}/versions/${validId(ticket.version_id)}/promote?async=1`,
      token,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": ticket.id,
          "X-Spacefast-Continuation-Token": action.token,
        },
        body: JSON.stringify({ channel: "live" }),
      },
    );
    ticket.state = "submitted";
    ticket.operation_id =
      result.operation?.id || result.data?.operation?.id || null;
  } catch (error) {
    const known = error instanceof AppError;
    const definitive =
      known &&
      error.status >= 400 &&
      error.status < 500 &&
      ![
        "provider_approval_required",
        "idempotency_conflict_in_progress",
      ].includes(error.code);
    ticket.state = definitive
      ? "failed"
      : known && error.code === "provider_approval_required"
        ? "approval_only"
        : "uncertain";
    action.failureCode =
      known && /^[a-z0-9_]{1,80}$/.test(error.code)
        ? error.code
        : "execution_unverified";
    await db(env)
      .prepare("UPDATE tm_restore_actions SET payload = ? WHERE ticket_id = ?")
      .bind(await seal(sessionId, { action }), ticket.id)
      .run();
  }
  await db(env)
    .prepare("UPDATE tm_restores SET state = ?, operation_id = ? WHERE id = ?")
    .bind(ticket.state, ticket.operation_id || null, ticket.id)
    .run();
  await recordActivity(
    env,
    ticket.id,
    ticket.state,
    ticket.operation_id || null,
  );
}
async function restoreStatus(
  env: Env,
  ticket: Record<string, any>,
  token: string,
  sessionId: string,
) {
  let approvalUrl: string | null = null;
  let providerCode: string | undefined;
  const stored = (
    await db(env)
      .prepare(
        "SELECT * FROM tm_restore_actions WHERE ticket_id = ? AND session_id = ?",
      )
      .bind(ticket.id, await digest(sessionId))
      .all()
  ).results?.[0];
  if (stored) {
    const action = (await unseal(sessionId, stored.payload)).action!;
    approvalUrl = action.approved ? null : action.url;
    const now = Date.now();
    const pollLock = await db(env)
      .prepare(
        "UPDATE tm_restore_actions SET next_poll_at = ? WHERE ticket_id = ? AND next_poll_at <= ?",
      )
      .bind(now + 30000, ticket.id, now)
      .run();
    if (action.approved) {
      await executeApprovedRestore(env, ticket, token, sessionId, action);
    } else if ((pollLock.meta?.changes ?? pollLock.changes) === 1) {
      try {
        const resumed = (
          await upstream("/v1/actions/resume", token, {
            method: "POST",
            body: JSON.stringify({ continuationToken: action.token }),
          })
        ).data;
        if (["denied", "expired"].includes(resumed?.status)) {
          ticket.state = "failed";
        } else if (resumed?.status === "completed") {
          ticket.operation_id =
            resumed.result?.operation?.id ||
            resumed.result?.data?.operation?.id ||
            null;
          ticket.state =
            resumed.result?.approved === true && !ticket.operation_id
              ? "approved"
              : "submitted";
          if (ticket.state === "approved") {
            action.approved = true;
            // Preserve the original capability before replaying the exact
            // approved request, as required by the continuation handshake.
            await db(env)
              .prepare(
                "UPDATE tm_restore_actions SET payload = ? WHERE ticket_id = ?",
              )
              .bind(await seal(sessionId, { action }), ticket.id)
              .run();
          }
          approvalUrl = null;
        }
        if (resumed?.status === "pending") {
          const next = resumed.requiresAction;
          if (
            typeof next?.continuationToken === "string" &&
            next.continuationToken.length <= 4096
          )
            action.token = next.continuationToken;
          if (
            Number.isFinite(Number(next?.pollAfterSeconds)) &&
            Number(next.pollAfterSeconds) > 0
          )
            action.interval = Math.max(5, Number(next.pollAfterSeconds));
          await db(env)
            .prepare(
              "UPDATE tm_restore_actions SET payload = ?, next_poll_at = ? WHERE ticket_id = ?",
            )
            .bind(
              await seal(sessionId, { action }),
              Date.now() + action.interval * 1000,
              ticket.id,
            )
            .run();
        } else if (
          ["completed", "denied", "expired"].includes(resumed?.status)
        ) {
          await db(env)
            .prepare(
              "UPDATE tm_restores SET state = ?, operation_id = ? WHERE id = ?",
            )
            .bind(ticket.state, ticket.operation_id, ticket.id)
            .run();
          if (ticket.state === "approved") {
            await executeApprovedRestore(env, ticket, token, sessionId, action);
          } else {
            await db(env)
              .prepare("DELETE FROM tm_restore_actions WHERE ticket_id = ?")
              .bind(ticket.id)
              .run();
          }
        }
      } catch {
        // A lost one-time resume response must not create a new action.
      }
    }
    providerCode = action.failureCode;
  }
  // A competing status request may have advanced the same action.
  const current = (
    await db(env)
      .prepare("SELECT * FROM tm_restores WHERE id = ?")
      .bind(ticket.id)
      .all()
  ).results?.[0];
  if (current) ticket = current;
  if (ticket.state === "prepared" && Number(ticket.expires_at) < Date.now()) {
    await db(env)
      .prepare(
        "UPDATE tm_restores SET state = 'failed' WHERE id = ? AND state = 'prepared'",
      )
      .bind(ticket.id)
      .run();
    await db(env)
      .prepare(
        "DELETE FROM tm_restore_guards WHERE ticket_id = ? AND EXISTS (SELECT 1 FROM tm_restores WHERE id = ? AND state = 'failed')",
      )
      .bind(ticket.id, ticket.id)
      .run();
    return {
      status: "failed",
      operationStatus: "confirmation_expired",
      liveVersionId: null,
      liveUrl: null,
    };
  }
  const space = (
    await upstream(`/v1/spaces/${validId(ticket.space_id)}`, token)
  ).data;
  const operation = ticket.operation_id
    ? (await upstream(`/v1/operations/${validId(ticket.operation_id)}`, token))
        .data
    : null;
  const isLive = space.channels?.live?.versionId === ticket.version_id;
  const submitted = [
    "submitting",
    "submitted",
    "uncertain",
    "awaiting_approval",
    "approved",
    "resuming",
    "approval_only",
    "verified",
  ].includes(ticket.state);
  const status =
    submitted && isLive && (!operation || operation.status === "succeeded")
      ? "verified"
      : ["rejected", "failed"].includes(ticket.state) ||
          (operation && ["failed", "canceled"].includes(operation.status))
        ? "failed"
        : ticket.state === "approval_only"
          ? "unavailable"
          : "pending";
  if (["verified", "failed"].includes(status)) {
    await db(env)
      .prepare("UPDATE tm_restores SET state = ? WHERE id = ?")
      .bind(status, ticket.id)
      .run();
    await db(env)
      .prepare("DELETE FROM tm_restore_guards WHERE ticket_id = ?")
      .bind(ticket.id)
      .run();
    await db(env)
      .prepare("DELETE FROM tm_restore_actions WHERE ticket_id = ?")
      .bind(ticket.id)
      .run();
  }
  await recordActivity(
    env,
    ticket.id,
    status === "pending" || status === "unavailable" ? ticket.state : status,
    ticket.operation_id || null,
    operation?.status || null,
  );
  return {
    status,
    liveVersionId: space.channels?.live?.versionId,
    operationStatus: operation?.status ?? ticket.state,
    liveUrl: safeUrl(space.liveUrl),
    approvalUrl: status === "pending" ? approvalUrl : null,
    providerCode,
  };
}
export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  try {
    if (path === "/api/health") {
      if (env.DB) {
        await init(env);
        await env.DB.prepare("SELECT 1 AS ready").all();
      }
      return json({
        name: "Spacefast Time Machine",
        runtime: "Spacefast Functions",
        database: !!env.DB,
        account: "not-disclosed",
        api: "documented-v1",
      });
    }
    if (path === "/oauth/client-metadata.json" && request.method === "GET") {
      const origin = env.APP_ORIGIN || url.origin;
      return json({
        client_id:
          env.TM_OAUTH_CLIENT_ID || `${origin}/oauth/client-metadata.json`,
        client_name: "Spacefast Time Machine",
        client_uri: origin,
        redirect_uris: [`${origin}/api/auth/callback`],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: "spaces:read teams:read versions:download publish:write",
      });
    }
    if (request.method !== "GET") originCheck(request);
    const id = cookieId(request),
      session = await load(env, id);
    if (path === "/api/auth/start" && request.method === "POST") {
      const clientId = env.TM_OAUTH_CLIENT_ID;
      if (!clientId)
        throw new AppError(
          503,
          "oauth_unconfigured",
          "Account connection is unavailable until this deployment registers a public OAuth client. See the README setup instructions.",
        );
      if (url.protocol !== "https:")
        throw new AppError(
          503,
          "https_required",
          "Secure sign-in is available on the HTTPS Spacefast deployment.",
        );
      await init(env);
      if (id && session?.ownerId)
        await recoverSessionActivity(env, id, session.ownerId);
      const input = await request.formData(),
        restore = input.get("access") === "restore";
      const nextId = random(),
        state = random(),
        verifier = random();
      const scope = `spaces:read teams:read versions:download${restore ? " publish:write" : ""}`;
      await save(env, nextId, {
        state,
        verifier,
        requestedScopes: scope,
        returnTo: returnPath(input.get("returnTo")),
        clientId,
        pendingUntil: Date.now() + 10 * 60 * 1000,
        restore,
      });
      await db(env)
        .prepare("DELETE FROM tm_sessions WHERE expires_at < ?")
        .bind(Date.now())
        .run();
      await db(env)
        .prepare(
          "DELETE FROM tm_restores WHERE expires_at < ? AND state IN ('prepared', 'rejected', 'failed', 'verified')",
        )
        .bind(Date.now() - SESSION_MS)
        .run();
      const origin = env.APP_ORIGIN || url.origin;
      const authorize = new URL(`${ISSUER}/oauth2/authorize`);
      authorize.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: `${origin}/api/auth/callback`,
        scope,
        state,
        code_challenge: await digest(verifier),
        code_challenge_method: "S256",
      }).toString();
      // Start OAuth with a top-level GET navigation. Form POST redirect chains
      // can be blocked by form-action when Spacefast sends a person to its IdP.
      if (request.headers.get("Accept")?.includes("application/json"))
        return json({ authorizationUrl: authorize.href }, 200, {
          "Set-Cookie": sessionCookie(nextId),
        });
      return redirect(authorize.href, sessionCookie(nextId));
    }
    if (path === "/api/auth/callback" && request.method === "GET") {
      if (
        !id ||
        !session?.state ||
        !session.verifier ||
        session.state !== url.searchParams.get("state") ||
        (session.pendingUntil ?? 0) < Date.now()
      )
        throw new AppError(
          400,
          "oauth_state_invalid",
          "The sign-in attempt expired or could not be verified. Start a new connection.",
        );
      if (url.searchParams.has("error")) {
        await db(env)
          .prepare("DELETE FROM tm_sessions WHERE id = ?")
          .bind(await digest(id))
          .run();
        return redirect("/?auth_error=declined", sessionCookie("", 0));
      }
      if (url.searchParams.has("iss") && url.searchParams.get("iss") !== ISSUER)
        throw new AppError(
          400,
          "issuer_invalid",
          "Unexpected authorization server.",
        );
      const code = url.searchParams.get("code");
      if (!code || code.length > 4096)
        throw new AppError(
          400,
          "code_missing",
          "The sign-in response did not include an authorization code.",
        );
      const origin = env.APP_ORIGIN || url.origin;
      const response = await fetch(`${ISSUER}/oauth2/token`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: session.clientId || env.TM_OAUTH_CLIENT_ID || "",
          redirect_uri: `${origin}/api/auth/callback`,
          code_verifier: session.verifier,
          code,
        }).toString(),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new AppError(
          502,
          "oauth_exchange_failed",
          "Spacefast could not finish sign-in. Please connect again.",
        );
      const tokens = (await response.json()) as any;
      if (
        typeof tokens.access_token !== "string" ||
        tokens.token_type?.toLowerCase() !== "bearer"
      )
        throw new AppError(
          502,
          "oauth_token_invalid",
          "Spacefast returned an unsupported token response.",
        );
      // Rotate the cookie after OAuth; neither the token nor the verifier is sent to the client.
      const nextId = random();
      await save(env, nextId, {
        accessToken: tokens.access_token,
        scope:
          typeof tokens.scope === "string"
            ? tokens.scope
            : session.requestedScopes,
        expiresAt:
          Date.now() +
          Math.min(Number(tokens.expires_in) || 3600, SESSION_MS / 1000) * 1000,
        restore: session.restore,
      });
      await db(env)
        .prepare("DELETE FROM tm_sessions WHERE id = ?")
        .bind(await digest(id))
        .run();
      return redirect(session.returnTo || "/", sessionCookie(nextId));
    }
    if (path === "/api/session" && request.method === "GET") {
      if (!session?.accessToken || (session.expiresAt ?? 0) < Date.now())
        return json({ connected: false, hosted: !!env.DB });
      const me = (await upstream("/v1/me", session.accessToken)).data;
      if (!session.ownerId && typeof me.user?.id === "string") {
        session.ownerId = await digest(`owner:${me.user.id}`);
        await save(env, id!, session);
      }
      const pending = session.ownerId
        ? (
            await db(env)
              .prepare(
                "SELECT ticket_id FROM tm_restore_guards WHERE owner_id = ?",
              )
              .bind(session.ownerId)
              .all()
          ).results || []
        : [];
      return json({
        connected: true,
        name: me.user?.name || me.user?.email || "Spacefast account",
        canRestore:
          session.restore === true &&
          !!session.scope?.split(" ").includes("publish:write"),
        expiresAt: session.expiresAt,
        pendingTickets: pending.map((row) => row.ticket_id),
      });
    }
    if (path === "/api/auth/logout" && request.method === "POST") {
      if (id && env.DB) {
        await db(env)
          .prepare("DELETE FROM tm_restore_actions WHERE session_id = ?")
          .bind(await digest(id))
          .run();
        await db(env)
          .prepare("DELETE FROM tm_sessions WHERE id = ?")
          .bind(await digest(id))
          .run();
        await db(env)
          .prepare(
            "DELETE FROM tm_restores WHERE session_id = ? AND state = 'prepared'",
          )
          .bind(await digest(id))
          .run();
      }
      return json({ connected: false }, 200, {
        "Set-Cookie": sessionCookie("", 0),
      });
    }
    if (!id || !session?.accessToken || (session.expiresAt ?? 0) < Date.now())
      throw new AppError(
        401,
        "connection_required",
        "Connect your Spacefast account to load your deployments.",
      );
    const token = session.accessToken;
    if (path === "/api/version" && request.method === "GET") {
      const spaceId = validId(url.searchParams.get("spaceId"));
      const versionId = validId(url.searchParams.get("versionId"));
      const result = await upstream(
        `/v1/spaces/${spaceId}/versions/${versionId}`,
        token,
      );
      if (result.data?.id !== versionId || result.data?.spaceId !== spaceId)
        throw new AppError(
          502,
          "version_unavailable",
          "Spacefast returned an unexpected version. The shared comparison could not be loaded.",
        );
      return json({ data: versionView(result.data) });
    }
    if (path === "/api/compare" && request.method === "GET") {
      const spaceId = validId(url.searchParams.get("spaceId"));
      const base = validId(url.searchParams.get("baseVersionId"));
      const target = validId(url.searchParams.get("versionId"));
      if (base === target)
        throw new AppError(
          400,
          "comparison_invalid",
          "Choose two different versions to compare.",
        );
      const params = new URLSearchParams({
        baseVersionId: base,
        versionId: target,
        limit: "100",
      });
      for (const [name, max] of [
        ["cursor", 4000],
        ["path", 1024],
      ] as const) {
        const value = url.searchParams.get(name);
        if (value) {
          if (value.length > max || value.includes("\0"))
            throw new AppError(
              400,
              "comparison_invalid",
              "The comparison path or cursor is invalid.",
            );
          params.set(name, value);
        }
      }
      const d = (
        await upstream(
          `/v1/spaces/${spaceId}/versions/compare?${params}`,
          token,
        )
      ).data;
      if (
        d?.spaceId !== spaceId ||
        d.baseDeploymentVersionId !== base ||
        d.deploymentVersionId !== target ||
        !Array.isArray(d.files) ||
        !d.stats ||
        ![
          d.stats.files,
          d.stats.added,
          d.stats.modified,
          d.stats.deleted,
        ].every((v) => Number.isSafeInteger(v) && v >= 0)
      )
        throw new AppError(
          502,
          "comparison_unavailable",
          "Spacefast did not return the requested deployment comparison.",
        );
      const side = (v: any) =>
        v
          ? {
              size: v.size ?? null,
              contentType:
                typeof v.contentType === "string" ? v.contentType : null,
            }
          : null;
      return json({
        data: {
          spaceId: d.spaceId,
          baseDeploymentVersionId: d.baseDeploymentVersionId,
          deploymentVersionId: d.deploymentVersionId,
          baseVersionNumber: d.baseVersionNumber,
          versionNumber: d.versionNumber,
          stats: d.stats && {
            files: d.stats.files,
            added: d.stats.added,
            modified: d.stats.modified,
            deleted: d.stats.deleted,
          },
          files: (d.files || []).map((f: any) => ({
            path: f.path,
            state: f.state,
            before: side(f.before),
            after: side(f.after),
          })),
          file: d.file
            ? {
                path: d.file.path,
                before:
                  typeof d.file.before === "string" ? d.file.before : null,
                after: typeof d.file.after === "string" ? d.file.after : null,
                beforeReason: d.file.beforeReason || null,
                afterReason: d.file.afterReason || null,
              }
            : null,
          pagination: pagination(d.pagination),
        },
      });
    }
    if (path === "/api/restore/activity" && request.method === "GET") {
      const spaceId = validId(url.searchParams.get("spaceId"));
      await upstream(`/v1/spaces/${spaceId}`, token);
      const ownerId = await ownerFor(env, id, session);
      await recoverSessionActivity(env, id, ownerId);
      let beforeTime = Number.MAX_SAFE_INTEGER,
        beforeId = "~";
      const cursor = url.searchParams.get("cursor");
      if (cursor) {
        try {
          if (cursor.length > 400) throw new Error();
          const parsed = JSON.parse(new TextDecoder().decode(unbase64(cursor)));
          if (
            !Number.isFinite(parsed.time) ||
            typeof parsed.id !== "string" ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(parsed.id)
          )
            throw new Error();
          beforeTime = parsed.time;
          beforeId = parsed.id;
        } catch {
          throw new AppError(
            400,
            "cursor_invalid",
            "This activity cursor is invalid.",
          );
        }
      }
      const rows =
        (
          await db(env)
            .prepare(
              "SELECT a.*, r.state AS current_state, r.operation_id AS current_operation_id FROM tm_restore_activity a LEFT JOIN tm_restores r ON r.id = a.id WHERE a.owner_id = ? AND a.space_id = ? AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?)) ORDER BY a.created_at DESC, a.id DESC LIMIT 21",
            )
            .bind(ownerId, spaceId, beforeTime, beforeTime, beforeId)
            .all()
        ).results || [];
      const page = rows.slice(0, 20),
        last = page[page.length - 1];
      return json({
        data: page.map((r) => ({
          id: r.id,
          spaceId: r.space_id,
          slug: r.slug,
          fromVersionId: r.from_version,
          toVersionId: r.to_version,
          state: r.current_state || r.state,
          operationStatus: r.operation_status || null,
          createdAt: new Date(Number(r.created_at)).toISOString(),
          finishedAt: r.finished_at
            ? new Date(Number(r.finished_at)).toISOString()
            : null,
        })),
        pagination: {
          hasMore: rows.length > 20,
          nextCursor:
            rows.length > 20
              ? base64url(
                  encoder.encode(
                    JSON.stringify({
                      time: Number(last.created_at),
                      id: last.id,
                    }),
                  ),
                )
              : null,
        },
      });
    }
    if (path === "/api/restore/pending" && request.method === "GET") {
      const ownerId = await ownerFor(env, id, session);
      const selectedSpace = url.searchParams.get("spaceId");
      if (selectedSpace) validId(selectedSpace);
      const pending = await db(env)
        .prepare(
          selectedSpace
            ? "SELECT ticket_id FROM tm_restore_guards WHERE owner_id = ? AND space_id = ?"
            : "SELECT ticket_id FROM tm_restore_guards WHERE owner_id = ?",
        )
        .bind(...(selectedSpace ? [ownerId, selectedSpace] : [ownerId]))
        .all();
      return json({
        tickets: (pending.results || []).map((row) => row.ticket_id),
      });
    }
    if (path === "/api/spaces" && request.method === "GET") {
      const params = new URLSearchParams({ limit: "30" });
      for (const key of ["cursor", "query"])
        if (url.searchParams.get(key))
          params.set(key, url.searchParams.get(key)!.slice(0, 2048));
      const result = await upstream(`/v1/spaces?${params}`, token);
      return json({
        data: result.data.map(spaceView),
        pagination: pagination(result.pagination),
      });
    }
    if (path === "/api/history" && request.method === "GET") {
      const spaceId = validId(url.searchParams.get("spaceId"));
      const params = new URLSearchParams({ limit: "40" });
      if (url.searchParams.get("cursor"))
        params.set("cursor", url.searchParams.get("cursor")!.slice(0, 2048));
      const [space, versions] = await Promise.all([
        upstream(`/v1/spaces/${spaceId}`, token),
        upstream(`/v1/spaces/${spaceId}/versions?${params}`, token),
      ]);
      return json({
        space: spaceView(space.data),
        data: versions.data.map(versionView),
        pagination: pagination(versions.pagination),
      });
    }
    if (path === "/api/preview" && request.method === "POST") {
      const body = (await request.json()) as any,
        spaceId = validId(body.spaceId),
        versionId = validId(body.versionId);
      const result = await upstream(
        `/v1/spaces/${spaceId}/versions/${versionId}/preview-session`,
        token,
        { method: "POST", body: JSON.stringify({ landingPath: "/" }) },
      );
      const previewUrl = safeUrl(result.data?.url);
      if (
        !previewUrl ||
        result.data.versionId !== body.versionId ||
        new URL(previewUrl).origin === url.origin
      )
        throw new AppError(
          502,
          "preview_unavailable",
          "Spacefast did not return a safe preview for this version.",
        );
      // This is the documented short-lived, version-only framing proof, never an account credential.
      return json({ url: previewUrl, expiresAt: result.data.expiresAt });
    }
    if (path === "/api/restore/prepare" && request.method === "POST") {
      if (
        !session.restore ||
        !session.scope?.split(" ").includes("publish:write")
      )
        throw new AppError(
          403,
          "restore_unavailable",
          "Restore is unavailable on a read-only connection. Reconnect with restore access.",
        );
      const body = (await request.json()) as any,
        spaceId = validId(body.spaceId),
        versionId = validId(body.versionId);
      const [space, version] = await Promise.all([
        upstream(`/v1/spaces/${spaceId}`, token),
        upstream(`/v1/spaces/${spaceId}/versions/${versionId}`, token),
      ]);
      const pending = (
        await db(env)
          .prepare("SELECT ticket_id FROM tm_restore_guards WHERE space_id = ?")
          .bind(body.spaceId)
          .all()
      ).results?.[0];
      if (pending)
        throw new AppError(
          409,
          "restore_pending",
          "A previous restore for this Space still needs verification. Check its status before starting another.",
        );
      if (
        version.data.status !== "ready" ||
        version.data.spaceId !== body.spaceId
      )
        throw new AppError(
          409,
          "version_not_ready",
          "Only a ready version belonging to this Space can be restored.",
        );
      const live = space.data.channels?.live?.versionId;
      if (
        !live ||
        live === body.versionId ||
        space.data.disabled ||
        space.data.status !== "active" ||
        ["queued", "running"].includes(space.data.operation?.status)
      )
        throw new AppError(
          409,
          "space_not_restorable",
          "This Space is already on that version, unavailable, or has a deployment in progress. Refresh its history.",
        );
      const ticket = random();
      await db(env)
        .prepare(
          "INSERT INTO tm_restores (id, session_id, space_id, version_id, expected_live, slug, expires_at, state, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          ticket,
          await digest(id),
          body.spaceId,
          body.versionId,
          live,
          space.data.slug,
          Date.now() + 120000,
          "prepared",
          null,
        )
        .run();
      return json({
        ticket,
        slug: space.data.slug,
        expectedLive: live,
        target: versionView(version.data),
        expiresIn: 120,
        warning:
          "This changes the live deployment and may reactivate runtime code or migrations. Spacefast does not document an atomic compare-and-swap promotion, so another deployment can race this action.",
      });
    }
    if (path === "/api/restore/confirm" && request.method === "POST") {
      if (
        !session.restore ||
        !session.scope?.split(" ").includes("publish:write")
      )
        throw new AppError(
          403,
          "restore_unavailable",
          "Restore permission is unavailable.",
        );
      const body = (await request.json()) as any,
        ticket = await ticketFor(env, id, body.ticket);
      if (
        ticket.state !== "prepared" ||
        Number(ticket.expires_at) < Date.now() ||
        body.confirmSlug !== ticket.slug
      )
        throw new AppError(
          409,
          "confirmation_invalid",
          "Confirmation expired, was already used, or did not match the Space slug.",
        );
      const space = (
        await upstream(`/v1/spaces/${validId(ticket.space_id)}`, token)
      ).data;
      if (
        space.channels?.live?.versionId !== ticket.expected_live ||
        space.status !== "active" ||
        space.disabled ||
        ["queued", "running"].includes(space.operation?.status)
      )
        throw new AppError(
          409,
          "live_changed",
          "The live deployment changed. Refresh history and review a new confirmation.",
        );
      const ownerId = await ownerFor(env, id, session);
      const guard = await db(env)
        .prepare(
          "INSERT INTO tm_restore_guards (space_id, ticket_id, owner_id) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM tm_restore_guards WHERE space_id = ?)",
        )
        .bind(ticket.space_id, body.ticket, ownerId, ticket.space_id)
        .run();
      if ((guard.meta?.changes ?? guard.changes) !== 1)
        throw new AppError(
          409,
          "restore_pending",
          "Another restore for this Space is unresolved. Check its status before starting another.",
        );
      const lock = await db(env)
        .prepare("UPDATE tm_restores SET state = ? WHERE id = ? AND state = ?")
        .bind("submitting", body.ticket, "prepared")
        .run();
      if ((lock.meta?.changes ?? lock.changes) !== 1) {
        await db(env)
          .prepare("DELETE FROM tm_restore_guards WHERE ticket_id = ?")
          .bind(body.ticket)
          .run();
        throw new AppError(
          409,
          "confirmation_used",
          "This confirmation has already been submitted.",
        );
      }
      await db(env)
        .prepare(
          "INSERT INTO tm_restore_activity (id, owner_id, space_id, slug, from_version, to_version, state, operation_id, operation_status, created_at, updated_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, 'submitting', NULL, NULL, ?, ?, NULL)",
        )
        .bind(
          body.ticket,
          ownerId,
          ticket.space_id,
          ticket.slug,
          ticket.expected_live,
          ticket.version_id,
          Date.now(),
          Date.now(),
        )
        .run();
      try {
        const result = await upstream(
          `/v1/spaces/${validId(ticket.space_id)}/versions/${validId(ticket.version_id)}/promote?async=1`,
          token,
          {
            method: "POST",
            headers: { "Idempotency-Key": body.ticket },
            body: JSON.stringify({ channel: "live" }),
          },
        );
        const operationId =
          result.operation?.id || result.data?.operation?.id || null;
        await db(env)
          .prepare(
            "UPDATE tm_restores SET state = ?, operation_id = ? WHERE id = ?",
          )
          .bind("submitted", operationId, body.ticket)
          .run();
        await recordActivity(env, body.ticket, "submitted", operationId);
        return json({ ticket: body.ticket, status: "submitted", operationId });
      } catch (error) {
        if (error instanceof AppError && error.action) {
          await db(env)
            .prepare(
              "INSERT INTO tm_restore_actions (ticket_id, session_id, payload, next_poll_at) VALUES (?, ?, ?, ?)",
            )
            .bind(
              body.ticket,
              await digest(id),
              await seal(id, { action: error.action }),
              Date.now() + error.action.interval * 1000,
            )
            .run();
          await db(env)
            .prepare(
              "UPDATE tm_restores SET state = 'awaiting_approval' WHERE id = ?",
            )
            .bind(body.ticket)
            .run();
          await recordActivity(env, body.ticket, "awaiting_approval");
          return json({
            ticket: body.ticket,
            status: "approval_required",
            approvalUrl: error.action.url,
            expiresAt: error.action.expiresAt,
          });
        }
        const rejected =
          error instanceof AppError &&
          error.code !== "provider_approval_required" &&
          error.status >= 400 &&
          error.status < 500;
        await db(env)
          .prepare("UPDATE tm_restores SET state = ? WHERE id = ?")
          .bind(rejected ? "rejected" : "uncertain", body.ticket)
          .run();
        await recordActivity(
          env,
          body.ticket,
          rejected ? "rejected" : "uncertain",
        );
        if (rejected)
          await db(env)
            .prepare("DELETE FROM tm_restore_guards WHERE ticket_id = ?")
            .bind(body.ticket)
            .run();
        throw error;
      }
    }
    if (path === "/api/restore/status" && request.method === "GET") {
      const ownerId = await ownerFor(env, id, session);
      const ticket = await ticketFor(
        env,
        id,
        url.searchParams.get("ticket") || "",
        ownerId,
      );
      return json(await restoreStatus(env, ticket, token, id));
    }
    return json({ error: "Route unavailable.", code: "not_found" }, 404);
  } catch (error) {
    if (path === "/api/auth/callback")
      return redirect("/?auth_error=connection");
    if (error instanceof AppError)
      return json(
        { error: error.message, code: error.code, requestId: error.requestId },
        error.status,
      );
    return json(
      {
        error:
          "The Spacefast runtime could not complete this request. Check the Space is claimed and its database is available, then retry.",
        code: "runtime_request_failed",
      },
      503,
    );
  }
}
