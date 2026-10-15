import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  API,
  ISSUER,
  digest,
  handle,
  seal,
  unseal,
  versionView,
  type Env,
} from "../functions/_app";

// Executes the same SQL against SQLite's D1-compatible statement surface.
function environment(): Env {
  const sqlite = new DatabaseSync(":memory:");
  return {
    TM_OAUTH_CLIENT_ID: "synthetic-public-client",
    DB: {
      prepare(sql: string) {
        let args: any[] = [];
        const statement = {
          bind(...values: any[]) {
            args = values;
            return statement;
          },
          async all() {
            return { results: sqlite.prepare(sql).all(...args) as any[] };
          },
          async run() {
            return {
              meta: {
                changes: Number(sqlite.prepare(sql).run(...args).changes),
              },
            };
          },
        };
        return statement;
      },
    },
  };
}
const origin = "https://time-machine.space.fast";
const id = "A".repeat(43);
const token = "synthetic-test-token";
function request(path: string, body?: unknown, cookie = id, cross = false) {
  return new Request(`${origin}${path}`, {
    headers: {
      ...(cookie ? { Cookie: `__Host-tm=${cookie}` } : {}),
      ...(body === undefined
        ? {}
        : {
            Origin: cross ? "https://other.invalid" : origin,
            "Content-Type": "application/json",
          }),
    },
    ...(body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body) }),
  });
}
async function authenticated(env: Env, restore = true) {
  await handle(request("/api/session"), env);
  await env
    .DB!.prepare(
      "INSERT INTO tm_sessions (id, payload, expires_at) VALUES (?, ?, ?)",
    )
    .bind(
      await digest(id),
      await seal(id, {
        accessToken: token,
        expiresAt: Date.now() + 360000,
        scope: `spaces:read${restore ? " publish:write" : ""}`,
        restore,
        ownerId: "synthetic-owner",
      }),
      Date.now() + 360000,
    )
    .run();
}
function upstream(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
const space = {
  id: "spc_test",
  slug: "my-studio",
  title: "My Studio",
  status: "active",
  channels: { live: { versionId: "ver_live" } },
  liveUrl: "https://my-studio.space.fast",
  disabled: null,
};
const version = {
  id: "ver_old",
  spaceId: "spc_test",
  number: 2,
  status: "ready",
  immutableUrl: "https://my-studio--v2.space.fast",
  source: { message: "Previous version" },
  config: { secret: "must-never-leave-server" },
  pendingUploads: ["must-never-leave-server"],
};
afterEach(() => vi.unstubAllGlobals());

describe("secure connection", () => {
  it("returns only the public authorization URL for a browser navigation, with the verifier kept server-side", async () => {
    const env = environment();
    const response = await handle(
      new Request(`${origin}/api/auth/start`, {
        method: "POST",
        headers: { Origin: origin, Accept: "application/json" },
        body: new URLSearchParams({ access: "read" }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const destination = new URL(body.authorizationUrl);
    expect(destination.origin + destination.pathname).toBe(
      `${ISSUER}/oauth2/authorize`,
    );
    expect(destination.searchParams.has("code_verifier")).toBe(false);
    expect(Object.keys(body)).toEqual(["authorizationUrl"]);
    expect(response.headers.get("Set-Cookie")).toContain(
      "HttpOnly; Secure; SameSite=Lax",
    );
  });
  it("returns a truthful disconnected state without a runtime database", async () => {
    expect(await (await handle(request("/api/session"), {})).json()).toEqual({
      connected: false,
      hosted: false,
    });
  });
  it("uses discoverable public OAuth metadata and supported scopes", async () => {
    const r = await handle(request("/oauth/client-metadata.json"), {});
    const body = await r.json();
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.redirect_uris).toEqual([`${origin}/api/auth/callback`]);
    expect(body.scope).toBe(
      "spaces:read teams:read versions:download publish:write",
    );
  });
  it("encrypts credentials so the database alone cannot decrypt them", async () => {
    const blob = await seal(id, { accessToken: token });
    expect(blob).not.toContain(token);
    expect(await unseal(id, blob)).toEqual({ accessToken: token });
    await expect(unseal("B".repeat(43), blob)).rejects.toThrow();
  });
  it("rejects cross-origin mutations before invoking the provider", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await handle(request("/api/auth/logout", {}, id, true), {})).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("starts OAuth with PKCE and a protected cookie, without reflecting the verifier", async () => {
    const req = new Request(`${origin}/api/auth/start`, {
      method: "POST",
      headers: { Origin: origin },
      body: new URLSearchParams({ access: "read" }),
    });
    const response = await handle(req, environment());
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe(
      `${ISSUER}/oauth2/authorize`,
    );
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("client_id")).toBe(
      "synthetic-public-client",
    );
    expect(location.searchParams.get("scope")).toBe(
      "spaces:read teams:read versions:download",
    );
    expect(location.searchParams.has("code_verifier")).toBe(false);
    expect(response.headers.get("Set-Cookie")).toMatch(
      /HttpOnly; Secure; SameSite=Lax/,
    );
  });
  it("rejects wrong OAuth state and never exchanges it", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const env = environment();
    await authenticated(env);
    const r = await handle(
      request("/api/auth/callback?state=wrong&code=irrelevant"),
      env,
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("Location")).toBe("/?auth_error=connection");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("completes OAuth only server-side and rotates the session identifier", async () => {
    const env = environment();
    await authenticated(env);
    await env
      .DB!.prepare("UPDATE tm_sessions SET payload = ? WHERE id = ?")
      .bind(
        await seal(id, {
          state: "synthetic-state",
          verifier: "synthetic-verifier",
          pendingUntil: Date.now() + 60000,
          requestedScopes: "spaces:read teams:read",
        }),
        await digest(id),
      )
      .run();
    const fetcher = vi.fn().mockResolvedValue(
      upstream({
        access_token: token,
        token_type: "Bearer",
        expires_in: 3600,
        scope: "spaces:read teams:read",
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const r = await handle(
      request(
        `/api/auth/callback?state=synthetic-state&code=synthetic-code&iss=${encodeURIComponent(ISSUER)}`,
      ),
      env,
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("Location")).toBe("/");
    expect(await r.text()).not.toContain(token);
    expect(r.headers.get("Set-Cookie")).not.toContain(id);
    expect(r.headers.get("Set-Cookie")).not.toContain(token);
    expect(String(fetcher.mock.calls[0][1].body)).toContain(
      "code_verifier=synthetic-verifier",
    );
    expect(
      (
        await env
          .DB!.prepare("SELECT * FROM tm_sessions WHERE id = ?")
          .bind(await digest(id))
          .all()
      ).results,
    ).toHaveLength(0);
  });
  it("does not expose provider identity tokens or credentials from /me", async () => {
    const env = environment();
    await authenticated(env);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        upstream({
          data: {
            user: { name: "Test User", email: "test@example.invalid" },
            intercom: { secret: token },
          },
        }),
      ),
    );
    const r = await handle(request("/api/session"), env),
      text = await r.text();
    expect(text).toContain("Test User");
    expect(text).not.toContain(token);
    expect(text).not.toContain("intercom");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
  it("removes server credentials on disconnect", async () => {
    const env = environment();
    await authenticated(env);
    const r = await handle(request("/api/auth/logout", {}), env);
    expect(r.status).toBe(200);
    expect(r.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(
      (await env.DB!.prepare("SELECT * FROM tm_sessions").all()).results,
    ).toHaveLength(0);
  });
});

describe("documented read APIs", () => {
  it("rejects provider redirects without following them or forwarding credentials", async () => {
    const env = environment();
    await authenticated(env);
    const fetcher = vi.fn().mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { Location: "https://other.invalid" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await handle(request("/api/spaces"), env);
    expect(result.status).toBe(502);
    expect((await result.json()).code).toBe("provider_redirect_rejected");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
  });
  it("refuses all account data without a connection", async () => {
    expect(
      (await handle(request("/api/spaces", undefined, ""), environment()))
        .status,
    ).toBe(401);
  });
  it("passes cursors and returns only the public projection", async () => {
    const env = environment();
    await authenticated(env);
    const fetcher = vi.fn().mockResolvedValue(
      upstream({
        data: [{ ...space, config: { secret: token } }],
        pagination: { hasMore: true, nextCursor: "opaque-next" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const r = await handle(
        request("/api/spaces?query=studio&cursor=opaque-in"),
        env,
      ),
      data = await r.json();
    expect(fetcher.mock.calls[0][0]).toBe(
      `${API}/v1/spaces?limit=30&cursor=opaque-in&query=studio`,
    );
    expect(data.pagination.nextCursor).toBe("opaque-next");
    expect(data.data[0].liveVersionId).toBe("ver_live");
    expect(JSON.stringify(data)).not.toContain(token);
  });
  it("loads actual version history and the current channel separately", async () => {
    const env = environment();
    await authenticated(env);
    const fetcher = vi.fn().mockImplementation(async (url: string) =>
      upstream(
        url.includes("/versions?")
          ? {
              data: [version],
              pagination: { nextCursor: null, hasMore: false },
            }
          : { data: space },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const r = await handle(request("/api/history?spaceId=spc_test"), env),
      data = await r.json();
    expect(data.data[0].number).toBe(2);
    expect(data.space.liveVersionId).toBe("ver_live");
    expect(JSON.stringify(data)).not.toContain("must-never-leave-server");
  });
  it("marks absent and unsafe immutable links unavailable", () => {
    expect(versionView({ immutableUrl: null }).immutableUrl).toBeNull();
    expect(
      versionView({ immutableUrl: "javascript:alert(1)" }).immutableUrl,
    ).toBeNull();
    expect(
      versionView({ immutableUrl: "https://user:password@example.invalid" })
        .immutableUrl,
    ).toBeNull();
  });
  it("sanitizes errors and distinguishes missing permission from unsupported fake data", async () => {
    const env = environment();
    await authenticated(env);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          upstream({ code: "insufficient_scope", detail: token }, 403),
        ),
    );
    const r = await handle(request("/api/spaces"), env);
    expect(r.status).toBe(403);
    const text = await r.text();
    expect(text).toContain("Unavailable");
    expect(text).not.toContain(token);
  });
  it("uses the documented version-scoped preview session without forwarding account credentials", async () => {
    const env = environment();
    await authenticated(env, false);
    const fetcher = vi.fn().mockResolvedValue(
      upstream({
        data: {
          versionId: version.id,
          origin: "https://my-studio--v2.space.fast",
          url: "https://my-studio--v2.space.fast/preview-proof-example",
          expiresAt: "2026-10-15T03:00:00Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const r = await handle(
        request("/api/preview", { spaceId: space.id, versionId: version.id }),
        env,
      ),
      text = await r.text();
    expect(r.status).toBe(200);
    expect(text).toContain("preview-proof-example");
    expect(text).not.toContain(token);
    expect(fetcher.mock.calls[0][0]).toBe(
      `${API}/v1/spaces/spc_test/versions/ver_old/preview-session`,
    );
    expect(fetcher.mock.calls[0][1].body).toBe('{"landingPath":"/"}');
  });
  it("refuses a preview URL on the application origin and unsupported preview permissions", async () => {
    const env = environment();
    await authenticated(env);
    const fetcher = vi.fn().mockResolvedValue(
      upstream({
        data: { versionId: version.id, url: origin + "/unsafe-frame" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(
      (
        await handle(
          request("/api/preview", { spaceId: space.id, versionId: version.id }),
          env,
        )
      ).status,
    ).toBe(502);
    fetcher.mockResolvedValue(upstream({ code: "insufficient_scope" }, 403));
    expect(
      (
        await handle(
          request("/api/preview", { spaceId: space.id, versionId: version.id }),
          env,
        )
      ).status,
    ).toBe(403);
  });
});

describe("safe restore", () => {
  it("recovers only the selected Space's pending restore for the authenticated owner", async () => {
    const { env } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    await handle(
      request("/api/restore/confirm", {
        ticket: prepared.ticket,
        confirmSlug: space.slug,
      }),
      env,
    );
    const own = await (
      await handle(request(`/api/restore/pending?spaceId=${space.id}`), env)
    ).json();
    const other = await (
      await handle(request("/api/restore/pending?spaceId=spc_other"), env)
    ).json();
    expect(own.tickets).toEqual([prepared.ticket]);
    expect(other.tickets).toEqual([]);
  });
  const approval = {
    actionType: "confirmation",
    continuationToken: "synthetic-private-continuation",
    url: "https://my.spacefast.com/approvals/test-decision",
    pollUrl: `${API}/v1/actions/resume`,
    pollAfterSeconds: 5,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  };
  async function setup(allow = true, status = "ready") {
    const env = environment();
    await authenticated(env, allow);
    const fetcher = vi
      .fn()
      .mockImplementation(async (url: string, options: RequestInit = {}) => {
        if (options.method === "POST")
          return upstream({
            data: version,
            operation: { id: "op_test", status: "running" },
          });
        return upstream({
          data: url.endsWith("/versions/ver_old")
            ? { ...version, status }
            : url.includes("/operations/")
              ? { status: "succeeded" }
              : space,
        });
      });
    vi.stubGlobal("fetch", fetcher);
    return { env, fetcher };
  }
  it("encrypts the provider approval and resumes once without repeating the promotion", async () => {
    const { env, fetcher } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    let completed = false;
    fetcher.mockImplementation(
      async (url: string, options: RequestInit = {}) => {
        if (url.endsWith("/actions/resume")) {
          completed = true;
          return upstream({
            data: {
              status: "completed",
              actionType: "confirmation",
              result: { operation: { id: "op_test", status: "succeeded" } },
            },
          });
        }
        if (options.method === "POST")
          return upstream(
            { code: "confirmation_required", details: approval },
            400,
          );
        return upstream({
          data: url.includes("/operations/")
            ? { status: "succeeded" }
            : {
                ...space,
                channels: {
                  live: { versionId: completed ? version.id : "ver_live" },
                },
              },
        });
      },
    );
    const result = await (
      await handle(
        request("/api/restore/confirm", {
          ticket: prepared.ticket,
          confirmSlug: space.slug,
        }),
        env,
      )
    ).json();
    expect(result.status).toBe("approval_required");
    expect(result.approvalUrl).toBe(approval.url);
    expect(JSON.stringify(result)).not.toContain(approval.continuationToken);
    const row = (
      await env.DB!.prepare("SELECT * FROM tm_restore_actions").all()
    ).results![0];
    expect(row.payload).not.toContain(approval.continuationToken);
    expect(row.payload).not.toContain(approval.url);
    expect(
      (
        await (
          await handle(
            request(`/api/restore/status?ticket=${prepared.ticket}`),
            env,
          )
        ).json()
      ).status,
    ).toBe("pending");
    await env
      .DB!.prepare("UPDATE tm_restore_actions SET next_poll_at = 0")
      .run();
    const statuses = await Promise.all(
      [1, 2].map(async () =>
        (
          await handle(
            request(`/api/restore/status?ticket=${prepared.ticket}`),
            env,
          )
        ).json(),
      ),
    );
    expect(statuses.some((r) => r.status === "verified")).toBe(true);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes("/promote?")),
    ).toHaveLength(1);
    const resumes = fetcher.mock.calls.filter(([url]) =>
      String(url).endsWith("/actions/resume"),
    );
    expect(resumes).toHaveLength(1);
    expect(resumes[0][1].body).toBe(
      JSON.stringify({ continuationToken: approval.continuationToken }),
    );
    expect(
      (await env.DB!.prepare("SELECT * FROM tm_restore_guards").all()).results,
    ).toHaveLength(0);
  });
  it("stops after a denied provider decision and never forwards its secret to the browser", async () => {
    const { env, fetcher } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    fetcher.mockImplementation(
      async (url: string, options: RequestInit = {}) =>
        url.endsWith("/actions/resume")
          ? upstream({
              data: {
                status: "denied",
                actionType: "confirmation",
                message: "Denied",
              },
            })
          : options.method === "POST"
            ? upstream({ requiresAction: approval }, 202)
            : upstream({ data: space }),
    );
    await handle(
      request("/api/restore/confirm", {
        ticket: prepared.ticket,
        confirmSlug: space.slug,
      }),
      env,
    );
    await env
      .DB!.prepare("UPDATE tm_restore_actions SET next_poll_at = 0")
      .run();
    const response = await handle(
      request(`/api/restore/status?ticket=${prepared.ticket}`),
      env,
    );
    const body = await response.json();
    expect(body.status).toBe("failed");
    expect(body.approvalUrl).toBeNull();
    expect(JSON.stringify(body)).not.toContain(approval.continuationToken);
    expect(
      (await env.DB!.prepare("SELECT * FROM tm_restore_actions").all()).results,
    ).toHaveLength(0);
  });
  async function approvedAttempt(
    mode: "success" | "changed" | "uncertain" = "success",
  ) {
    const { env, fetcher } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    let approved = false,
      live = false;
    fetcher.mockImplementation(
      async (url: string, options: RequestInit = {}) => {
        if (url.endsWith("/actions/resume")) {
          approved = true;
          return upstream({
            data: {
              status: "completed",
              actionType: "confirmation",
              result: { approved: true, approvalId: "gdc_test" },
            },
          });
        }
        if (options.method === "POST") {
          const headers = options.headers as Record<string, string>;
          if (
            headers["X-Spacefast-Continuation-Token"] ===
            approval.continuationToken
          ) {
            if (mode === "uncertain")
              throw new TypeError("network interrupted");
            return upstream({
              data: version,
              operation: { id: "op_test", status: "running" },
            });
          }
          return upstream({ requiresAction: approval }, 202);
        }
        return upstream({
          data: url.includes("/operations/")
            ? { status: live ? "succeeded" : "running" }
            : url.endsWith("/versions/ver_old")
              ? version
              : {
                  ...space,
                  channels: {
                    live: {
                      versionId: live
                        ? version.id
                        : approved && mode === "changed"
                          ? "ver_new"
                          : "ver_live",
                    },
                  },
                },
        });
      },
    );
    await handle(
      request("/api/restore/confirm", {
        ticket: prepared.ticket,
        confirmSlug: space.slug,
      }),
      env,
    );
    await env
      .DB!.prepare("UPDATE tm_restore_actions SET next_poll_at = 0")
      .run();
    const status = async () =>
      (
        await handle(
          request(`/api/restore/status?ticket=${prepared.ticket}`),
          env,
        )
      ).json();
    return {
      env,
      fetcher,
      prepared,
      status,
      setLive: () => {
        live = true;
      },
    };
  }
  it("replays the exact approved promotion once with its capability and retains pending until live verification", async () => {
    const { env, fetcher, prepared, status, setLive } = await approvedAttempt();
    const results = await Promise.all([status(), status()]);
    expect(results.every((r) => r.status === "pending")).toBe(true);
    const promotions = fetcher.mock.calls.filter(([url]) =>
      String(url).includes("/promote?"),
    );
    expect(promotions).toHaveLength(2);
    expect(promotions[1][0]).toBe(promotions[0][0]);
    expect(promotions[1][1].body).toBe(promotions[0][1].body);
    expect(promotions[1][1].headers["Idempotency-Key"]).toBe(prepared.ticket);
    expect(promotions[0][1].headers["Idempotency-Key"]).toBe(prepared.ticket);
    expect(
      promotions[0][1].headers["X-Spacefast-Continuation-Token"],
    ).toBeUndefined();
    expect(promotions[1][1].headers["X-Spacefast-Continuation-Token"]).toBe(
      approval.continuationToken,
    );
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith("/actions/resume"),
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(results)).not.toContain(approval.continuationToken);
    setLive();
    expect((await status()).status).toBe("verified");
    expect(
      (await env.DB!.prepare("SELECT * FROM tm_restore_guards").all()).results,
    ).toHaveLength(0);
  });
  it("refuses to execute an approval after another deployment changed the live pointer", async () => {
    const { fetcher, status } = await approvedAttempt("changed");
    expect((await status()).status).toBe("failed");
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes("/promote?")),
    ).toHaveLength(1);
  });
  it("recovers an encrypted approved phase without redeeming the one-time receipt again", async () => {
    const { env, fetcher, prepared, status } = await approvedAttempt();
    const row = (
      await env
        .DB!.prepare("SELECT * FROM tm_restore_actions WHERE ticket_id = ?")
        .bind(prepared.ticket)
        .all()
    ).results![0];
    const saved = await unseal(id, row.payload);
    expect(saved.action).toBeDefined();
    saved.action!.approved = true;
    await env
      .DB!.prepare(
        "UPDATE tm_restore_actions SET payload = ? WHERE ticket_id = ?",
      )
      .bind(await seal(id, saved), prepared.ticket)
      .run();
    await env
      .DB!.prepare("UPDATE tm_restores SET state = 'approved' WHERE id = ?")
      .bind(prepared.ticket)
      .run();
    expect((await status()).status).toBe("pending");
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith("/actions/resume"),
      ),
    ).toHaveLength(0);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes("/promote?")),
    ).toHaveLength(2);
    expect((await status()).operationStatus).toBe("running");
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes("/promote?")),
    ).toHaveLength(2);
  });
  it("never repeats approved execution after an ambiguous network outcome", async () => {
    const { env, fetcher, status } = await approvedAttempt("uncertain");
    expect((await status()).status).toBe("pending");
    expect((await status()).operationStatus).toBe("uncertain");
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes("/promote?")),
    ).toHaveLength(2);
    expect(
      (await env.DB!.prepare("SELECT * FROM tm_restore_guards").all()).results,
    ).toHaveLength(1);
  });
  it("requires explicit restore scope", async () => {
    const { env, fetcher } = await setup(false);
    expect(
      (
        await handle(
          request("/api/restore/prepare", {
            spaceId: space.id,
            versionId: version.id,
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses failed versions", async () => {
    const { env } = await setup(true, "failed");
    expect(
      (
        await handle(
          request("/api/restore/prepare", {
            spaceId: space.id,
            versionId: version.id,
          }),
          env,
        )
      ).status,
    ).toBe(409);
  });
  it("requires typed confirmation, rejects reuse, and sends one idempotent promotion", async () => {
    const { env, fetcher } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    expect(prepared.warning).toContain("compare-and-swap");
    expect(
      (
        await handle(
          request("/api/restore/confirm", {
            ticket: prepared.ticket,
            confirmSlug: "wrong",
          }),
          env,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await handle(
          request("/api/restore/confirm", {
            ticket: prepared.ticket,
            confirmSlug: space.slug,
          }),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handle(
          request("/api/restore/confirm", {
            ticket: prepared.ticket,
            confirmSlug: space.slug,
          }),
          env,
        )
      ).status,
    ).toBe(409);
    const posts = fetcher.mock.calls.filter(
      ([, options]: any[]) => options.method === "POST",
    );
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe(
      `${API}/v1/spaces/spc_test/versions/ver_old/promote?async=1`,
    );
    expect(posts[0][1].headers["Idempotency-Key"]).toBe(prepared.ticket);
  });
  it("rejects the confirmation if the live version changed after preparation", async () => {
    const { env, fetcher } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    fetcher.mockResolvedValue(
      upstream({
        data: { ...space, channels: { live: { versionId: "ver_newer" } } },
      }),
    );
    const r = await handle(
      request("/api/restore/confirm", {
        ticket: prepared.ticket,
        confirmSlug: space.slug,
      }),
      env,
    );
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("live_changed");
    expect(
      fetcher.mock.calls.filter(
        ([, options]: any[]) => options.method === "POST",
      ),
    ).toHaveLength(0);
  });
  it("does not call a submitted restore successful until the live pointer is verified", async () => {
    const { env, fetcher } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    await handle(
      request("/api/restore/confirm", {
        ticket: prepared.ticket,
        confirmSlug: space.slug,
      }),
      env,
    );
    expect(
      (
        await (
          await handle(
            request(`/api/restore/status?ticket=${prepared.ticket}`),
            env,
          )
        ).json()
      ).status,
    ).toBe("pending");
    fetcher.mockImplementation(async (url: string) =>
      upstream({
        data: url.includes("/operations/")
          ? { status: "succeeded" }
          : { ...space, channels: { live: { versionId: version.id } } },
      }),
    );
    expect(
      (
        await (
          await handle(
            request(`/api/restore/status?ticket=${prepared.ticket}`),
            env,
          )
        ).json()
      ).status,
    ).toBe("verified");
  });
  it("preserves ambiguous network outcomes for verification without resubmitting", async () => {
    const { env, fetcher } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    fetcher.mockImplementation(
      async (url: string, options: RequestInit = {}) => {
        if (options.method === "POST")
          throw new Error(
            "Synthetic connection lost after possible acceptance",
          );
        return upstream({ data: space });
      },
    );
    const result = await handle(
      request("/api/restore/confirm", {
        ticket: prepared.ticket,
        confirmSlug: space.slug,
      }),
      env,
    );
    expect(result.status).toBe(503);
    expect(
      (
        await (
          await handle(
            request(`/api/restore/status?ticket=${prepared.ticket}`),
            env,
          )
        ).json()
      ).status,
    ).toBe("pending");
    expect(
      (
        await handle(
          request("/api/restore/confirm", {
            ticket: prepared.ticket,
            confirmSlug: space.slug,
          }),
          env,
        )
      ).status,
    ).toBe(409);
    expect(
      fetcher.mock.calls.filter(
        ([, options]: any[]) => options.method === "POST",
      ),
    ).toHaveLength(1);
  });
  it("isolates restore tickets between sessions", async () => {
    const { env } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    const other = "B".repeat(43);
    await env
      .DB!.prepare(
        "INSERT INTO tm_sessions (id, payload, expires_at) VALUES (?, ?, ?)",
      )
      .bind(
        await digest(other),
        await seal(other, {
          accessToken: token,
          expiresAt: Date.now() + 100000,
          restore: true,
          scope: "publish:write",
          ownerId: "another-owner",
        }),
        Date.now() + 100000,
      )
      .run();
    expect(
      (
        await handle(
          request(
            `/api/restore/status?ticket=${prepared.ticket}`,
            undefined,
            other,
          ),
          env,
        )
      ).status,
    ).toBe(404);
  });
  it("recovers unresolved attempts after reconnect and blocks a new ticket", async () => {
    const { env, fetcher } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    fetcher.mockImplementation(
      async (_url: string, options: RequestInit = {}) => {
        if (options.method === "POST")
          throw new Error("Synthetic ambiguous transport failure");
        return upstream({ data: space });
      },
    );
    await handle(
      request("/api/restore/confirm", {
        ticket: prepared.ticket,
        confirmSlug: space.slug,
      }),
      env,
    );
    const other = "C".repeat(43);
    await env
      .DB!.prepare(
        "INSERT INTO tm_sessions (id, payload, expires_at) VALUES (?, ?, ?)",
      )
      .bind(
        await digest(other),
        await seal(other, {
          accessToken: token,
          ownerId: "synthetic-owner",
          scope: "spaces:read publish:write",
          restore: true,
          expiresAt: Date.now() + 100000,
        }),
        Date.now() + 100000,
      )
      .run();
    const pending = await (
      await handle(request("/api/restore/pending", undefined, other), env)
    ).json();
    expect(pending.tickets).toEqual([prepared.ticket]);
    expect(
      (
        await handle(
          request(
            "/api/restore/prepare",
            { spaceId: space.id, versionId: version.id },
            other,
          ),
          env,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await (
          await handle(
            request(
              `/api/restore/status?ticket=${prepared.ticket}`,
              undefined,
              other,
            ),
            env,
          )
        ).json()
      ).status,
    ).toBe("pending");
    expect(
      fetcher.mock.calls.filter(
        ([, options]: any[]) => options.method === "POST",
      ),
    ).toHaveLength(1);
  });
  it("serializes separate prepared confirmations at the Space boundary", async () => {
    const { env, fetcher } = await setup();
    const prepare = async () =>
      (
        await handle(
          request("/api/restore/prepare", {
            spaceId: space.id,
            versionId: version.id,
          }),
          env,
        )
      ).json();
    const a = await prepare(),
      b = await prepare();
    const replies = await Promise.all(
      [a, b].map((p) =>
        handle(
          request("/api/restore/confirm", {
            ticket: p.ticket,
            confirmSlug: space.slug,
          }),
          env,
        ),
      ),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      fetcher.mock.calls.filter(
        ([, options]: any[]) => options.method === "POST",
      ),
    ).toHaveLength(1);
  });
  it("keeps a pending guard through logout and releases it only after verified success", async () => {
    const { env, fetcher } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    await handle(
      request("/api/restore/confirm", {
        ticket: prepared.ticket,
        confirmSlug: space.slug,
      }),
      env,
    );
    await handle(request("/api/auth/logout", {}), env);
    expect(
      (await env.DB!.prepare("SELECT * FROM tm_restore_guards").all()).results,
    ).toHaveLength(1);
    await authenticated(env);
    fetcher.mockImplementation(async (url: string) =>
      upstream({
        data: url.includes("/operations/")
          ? { status: "succeeded" }
          : { ...space, channels: { live: { versionId: version.id } } },
      }),
    );
    expect(
      (
        await (
          await handle(
            request(`/api/restore/status?ticket=${prepared.ticket}`),
            env,
          )
        ).json()
      ).status,
    ).toBe("verified");
    expect(
      (await (await handle(request("/api/restore/pending"), env)).json())
        .tickets,
    ).toEqual([]);
  });
  it("does not report an unsubmitted confirmation as a completed restore", async () => {
    const { env, fetcher } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    fetcher.mockResolvedValue(
      upstream({
        data: { ...space, channels: { live: { versionId: version.id } } },
      }),
    );
    expect(
      (
        await (
          await handle(
            request(`/api/restore/status?ticket=${prepared.ticket}`),
            env,
          )
        ).json()
      ).status,
    ).toBe("pending");
  });
  it("clears the Space guard after a definite provider rejection", async () => {
    const { env, fetcher } = await setup();
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    fetcher.mockImplementation(
      async (_url: string, options: RequestInit = {}) =>
        options.method === "POST"
          ? upstream({ code: "forbidden" }, 403)
          : upstream({ data: space }),
    );
    expect(
      (
        await handle(
          request("/api/restore/confirm", {
            ticket: prepared.ticket,
            confirmSlug: space.slug,
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (await (await handle(request("/api/restore/pending"), env)).json())
        .tickets,
    ).toEqual([]);
  });
});

describe("comparisons, shared links and restore activity", () => {
  const comparisonPath =
    "/api/compare?spaceId=spc_test&baseVersionId=ver_live&versionId=ver_old";
  const comparison = {
    spaceId: space.id,
    baseDeploymentVersionId: "ver_live",
    deploymentVersionId: version.id,
    baseVersionNumber: 3,
    versionNumber: 2,
    stats: { files: 1, added: 0, modified: 1, deleted: 0 },
    files: [
      {
        path: "index.html",
        state: "modified",
        before: { size: 4, contentType: "text/html", secret: token },
        after: { size: 5, contentType: "text/html" },
      },
    ],
    file: {
      path: "index.html",
      before: "",
      after: "<h1>After</h1>",
      beforeReason: null,
      afterReason: null,
    },
    pagination: { hasMore: true, nextCursor: "next cursor" },
    secret: token,
  };
  async function setupRead() {
    const env = environment();
    await authenticated(env);
    const fetcher = vi.fn().mockResolvedValue(upstream({ data: comparison }));
    vi.stubGlobal("fetch", fetcher);
    return { env, fetcher };
  }
  it("keeps shared comparison and activity data behind account authorization", async () => {
    const env = environment();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const path of [
      comparisonPath,
      "/api/version?spaceId=spc_test&versionId=ver_old",
      "/api/restore/activity?spaceId=spc_test",
    ])
      expect((await handle(request(path, undefined, ""), env)).status).toBe(
        401,
      );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the documented comparison query and returns escaped text as data with unavailable reasons intact", async () => {
    const { env, fetcher } = await setupRead();
    const response = await handle(
      request(comparisonPath + "&path=index.html&cursor=opaque%20value"),
      env,
    );
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.data.file.before).toBe("");
    expect(data.data.file.after).toBe("<h1>After</h1>");
    expect(JSON.stringify(data)).not.toContain(token);
    expect(data.data.pagination.nextCursor).toBe("next cursor");
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe("/v1/spaces/spc_test/versions/compare");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("cursor")).toBe("opaque value");
    expect(url.searchParams.get("path")).toBe("index.html");
    fetcher.mockResolvedValue(
      upstream({
        data: {
          ...comparison,
          file: {
            path: "image.png",
            before: null,
            after: null,
            beforeReason: "binary",
            afterReason: "too_large",
          },
        },
      }),
    );
    expect(
      (
        await (
          await handle(request(comparisonPath + "&path=image.png"), env)
        ).json()
      ).data.file.afterReason,
    ).toBe("too_large");
  });
  it("rejects invalid comparison input and unexpected provider identities", async () => {
    const { env, fetcher } = await setupRead();
    expect(
      (
        await handle(
          request(comparisonPath.replace("ver_old", "ver_live")),
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (await handle(request(comparisonPath + "&path=" + "x".repeat(1025)), env))
        .status,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(
      upstream({ data: { ...comparison, spaceId: "spc_other" } }),
    );
    expect((await handle(request(comparisonPath), env)).status).toBe(502);
  });
  it("does not reflect provider secrets when a file download is forbidden", async () => {
    const { env, fetcher } = await setupRead();
    fetcher.mockResolvedValue(
      upstream(
        {
          code: "insufficient_scope",
          detail: token,
          details: { continuationToken: token },
        },
        403,
      ),
    );
    const r = await handle(request(comparisonPath + "&path=index.html"), env);
    expect(r.status).toBe(403);
    expect(await r.text()).not.toContain(token);
  });
  it("loads a linked historical version only from its requested Space", async () => {
    const { env, fetcher } = await setupRead();
    fetcher.mockResolvedValue(upstream({ data: version }));
    const r = await handle(
      request("/api/version?spaceId=spc_test&versionId=ver_old"),
      env,
    );
    expect((await r.json()).data.id).toBe(version.id);
    fetcher.mockResolvedValue(
      upstream({ data: { ...version, spaceId: "spc_other" } }),
    );
    expect(
      (
        await handle(
          request("/api/version?spaceId=spc_test&versionId=ver_old"),
          env,
        )
      ).status,
    ).toBe(502);
  });
  it("preserves only a local allowlisted comparison destination through OAuth", async () => {
    const env = environment();
    const r = await handle(
      new Request(origin + "/api/auth/start", {
        method: "POST",
        headers: { Origin: origin, Accept: "application/json" },
        body: new URLSearchParams({
          access: "read",
          returnTo:
            "/?space=spc_test&version=ver_old&compare=ver_live&view=files&redirect=https://evil.invalid&token=do-not-retain",
        }),
      }),
      env,
    );
    const cookie = r.headers.get("Set-Cookie")!.split(";")[0].split("=")[1];
    const rows = (await env.DB!.prepare("SELECT * FROM tm_sessions").all())
      .results!;
    const stored = await unseal(cookie, rows[0].payload);
    expect(stored.returnTo).toBe(
      "/?space=spc_test&version=ver_old&compare=ver_live&view=files",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        upstream({
          access_token: token,
          token_type: "Bearer",
          expires_in: 3600,
        }),
      ),
    );
    const completed = await handle(
      request(
        "/api/auth/callback?state=" + stored.state + "&code=synthetic-code",
        undefined,
        cookie,
      ),
      env,
    );
    expect(completed.headers.get("Location")).toBe(stored.returnTo);
    const bad = await handle(
      new Request(origin + "/api/auth/start", {
        method: "POST",
        headers: { Origin: origin },
        body: new URLSearchParams({ returnTo: "//evil.invalid/" }),
      }),
      env,
    );
    const badId = bad.headers.get("Set-Cookie")!.split(";")[0].split("=")[1];
    const badRow = (
      await env
        .DB!.prepare("SELECT * FROM tm_sessions WHERE id = ?")
        .bind(await digest(badId))
        .all()
    ).results![0];
    expect((await unseal(badId, badRow.payload)).returnTo).toBe("/");
  });
  async function activityAttempt() {
    const env = environment();
    await authenticated(env);
    let live = false;
    const fetcher = vi
      .fn()
      .mockImplementation(async (url: string, options: RequestInit = {}) =>
        upstream(
          options.method === "POST"
            ? { data: version, operation: { id: "op_test", status: "running" } }
            : {
                data: url.includes("/operations/")
                  ? { status: live ? "succeeded" : "running" }
                  : url.endsWith("/versions/ver_old")
                    ? version
                    : {
                        ...space,
                        channels: {
                          live: { versionId: live ? version.id : "ver_live" },
                        },
                      },
              },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const prepared = await (
      await handle(
        request("/api/restore/prepare", {
          spaceId: space.id,
          versionId: version.id,
        }),
        env,
      )
    ).json();
    await handle(
      request("/api/restore/confirm", {
        ticket: prepared.ticket,
        confirmSlug: space.slug,
      }),
      env,
    );
    return {
      env,
      fetcher,
      prepared,
      setLive: () => {
        live = true;
      },
    };
  }
  it("records pending and verified restores durably without storing credentials in the activity projection", async () => {
    const { env, prepared, setLive } = await activityAttempt();
    let activity = await (
      await handle(request("/api/restore/activity?spaceId=spc_test"), env)
    ).json();
    expect(activity.data[0].state).toBe("submitted");
    expect(activity.data[0].finishedAt).toBeNull();
    expect(activity.data[0].fromVersionId).toBe("ver_live");
    setLive();
    await handle(request("/api/restore/status?ticket=" + prepared.ticket), env);
    activity = await (
      await handle(request("/api/restore/activity?spaceId=spc_test"), env)
    ).json();
    expect(activity.data[0].state).toBe("verified");
    expect(activity.data[0].finishedAt).not.toBeNull();
    expect(JSON.stringify(activity)).not.toContain(token);
    await handle(request("/api/auth/logout", {}), env);
    const reconnected = "C".repeat(43);
    await env
      .DB!.prepare(
        "INSERT INTO tm_sessions (id,payload,expires_at) VALUES (?,?,?)",
      )
      .bind(
        await digest(reconnected),
        await seal(reconnected, {
          accessToken: token,
          expiresAt: Date.now() + 60000,
          scope: "spaces:read",
          ownerId: "synthetic-owner",
        }),
        Date.now() + 60000,
      )
      .run();
    expect(
      (
        await (
          await handle(
            request(
              "/api/restore/activity?spaceId=spc_test",
              undefined,
              reconnected,
            ),
            env,
          )
        ).json()
      ).data,
    ).toHaveLength(1);
  });
  it("isolates activity by owner and current Space permission", async () => {
    const { env, fetcher } = await activityAttempt();
    const other = "B".repeat(43);
    await env
      .DB!.prepare(
        "INSERT INTO tm_sessions (id,payload,expires_at) VALUES (?,?,?)",
      )
      .bind(
        await digest(other),
        await seal(other, {
          accessToken: token,
          expiresAt: Date.now() + 60000,
          scope: "spaces:read",
          ownerId: "another-owner",
        }),
        Date.now() + 60000,
      )
      .run();
    expect(
      (
        await (
          await handle(
            request("/api/restore/activity?spaceId=spc_test", undefined, other),
            env,
          )
        ).json()
      ).data,
    ).toEqual([]);
    fetcher.mockResolvedValue(upstream({ code: "forbidden" }, 403));
    expect(
      (await handle(request("/api/restore/activity?spaceId=spc_test"), env))
        .status,
    ).toBe(403);
  });
  it("paginates tied activity timestamps without duplicates and rejects invalid cursors", async () => {
    const { env, fetcher } = await setupRead();
    fetcher.mockImplementation(async () => upstream({ data: space }));
    for (let i = 0; i < 22; i++)
      await env
        .DB!.prepare(
          "INSERT INTO tm_restore_activity (id,owner_id,space_id,slug,from_version,to_version,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          "event_" + String(i).padStart(2, "0"),
          "synthetic-owner",
          space.id,
          space.slug,
          "ver_live",
          version.id,
          "verified",
          12345,
          12345,
        )
        .run();
    const first = await (
      await handle(request("/api/restore/activity?spaceId=spc_test"), env)
    ).json();
    expect(first.data).toHaveLength(20);
    expect(first.pagination.hasMore).toBe(true);
    const second = await (
      await handle(
        request(
          "/api/restore/activity?spaceId=spc_test&cursor=" +
            encodeURIComponent(first.pagination.nextCursor),
        ),
        env,
      )
    ).json();
    expect(second.data).toHaveLength(2);
    expect(new Set([...first.data, ...second.data].map((r) => r.id)).size).toBe(
      22,
    );
    expect(second.pagination.hasMore).toBe(false);
    expect(
      (
        await handle(
          request(
            "/api/restore/activity?spaceId=spc_test&cursor=not-valid-json",
          ),
          env,
        )
      ).status,
    ).toBe(400);
  });
  it("recovers earlier session records without inventing a completion time", async () => {
    const { env, prepared, setLive } = await activityAttempt();
    setLive();
    await handle(request("/api/restore/status?ticket=" + prepared.ticket), env);
    await env.DB!.prepare("DELETE FROM tm_restore_activity").run();
    const recovered = await (
      await handle(request("/api/restore/activity?spaceId=spc_test"), env)
    ).json();
    expect(recovered.data[0].state).toBe("verified");
    expect(recovered.data[0].finishedAt).toBeNull();
  });
  it("recovers earlier activity before rotating an expired OAuth session", async () => {
    const { env, prepared, setLive } = await activityAttempt();
    setLive();
    await handle(request("/api/restore/status?ticket=" + prepared.ticket), env);
    await env.DB!.prepare("DELETE FROM tm_restore_activity").run();
    const row = (
      await env
        .DB!.prepare("SELECT * FROM tm_sessions WHERE id = ?")
        .bind(await digest(id))
        .all()
    ).results![0];
    const saved = await unseal(id, row.payload);
    saved.expiresAt = Date.now() - 1;
    await env
      .DB!.prepare("UPDATE tm_sessions SET payload = ? WHERE id = ?")
      .bind(await seal(id, saved), await digest(id))
      .run();
    const result = await handle(
      new Request(origin + "/api/auth/start", {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: "__Host-tm=" + id,
          Accept: "application/json",
        },
        body: new URLSearchParams({
          access: "read",
          returnTo: "/?space=spc_test",
        }),
      }),
      env,
    );
    expect(result.status).toBe(200);
    const recovered = (
      await env.DB!.prepare("SELECT * FROM tm_restore_activity").all()
    ).results!;
    expect(recovered).toHaveLength(1);
    expect(recovered[0].owner_id).toBe("synthetic-owner");
    expect(recovered[0].state).toBe("verified");
    expect(recovered[0].finished_at).toBeNull();
  });
});
