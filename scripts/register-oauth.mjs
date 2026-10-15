// Registers an OAuth public client. No account credential or client secret is used.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const value = process.argv[2];
if (!value)
  throw new Error(
    "Usage: node scripts/register-oauth.mjs https://your-space.space.fast",
  );
const parsed = new URL(value);
if (
  parsed.protocol !== "https:" ||
  parsed.username ||
  parsed.password ||
  (parsed.pathname !== "/" && parsed.pathname !== "")
)
  throw new Error(
    "Supply the public HTTPS origin of your deployed app, without a path or credentials.",
  );
const origin = parsed.origin;
const file = `.local/oauth-public-${createHash("sha256").update(origin).digest("hex").slice(0, 16)}.json`;
let client;
try {
  client = JSON.parse(await readFile(file, "utf8"));
} catch {}
if (!client?.clientId) {
  const discovery = await (
    await fetch(
      "https://api.spacefast.com/.well-known/oauth-authorization-server",
    )
  ).json();
  if (
    discovery.registration_endpoint !==
      "https://api.spacefast.com/v1/auth/oauth2/register" ||
    !discovery.token_endpoint_auth_methods_supported?.includes("none") ||
    !discovery.code_challenge_methods_supported?.includes("S256")
  )
    throw new Error(
      "Spacefast does not advertise the public-client registration and PKCE capabilities this application needs.",
    );
  const response = await fetch(discovery.registration_endpoint, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Spacefast Time Machine",
      client_uri: origin,
      redirect_uris: [`${origin}/api/auth/callback`],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "spaces:read teams:read versions:download publish:write",
    }),
  });
  const result = await response.json();
  if (
    !response.ok ||
    typeof result.client_id !== "string" ||
    result.token_endpoint_auth_method !== "none" ||
    result.client_secret
  )
    throw new Error(
      `Public-client registration unavailable (HTTP ${response.status}). No response credentials were saved or printed.`,
    );
  client = { clientId: result.client_id, origin, authMethod: "none" };
  await mkdir(".local", { recursive: true });
  await writeFile(file, JSON.stringify(client, null, 2));
}
console.log(`Public OAuth client: ${client.clientId}`);
console.log(
  `Set this non-secret server variable: sf env set TM_OAUTH_CLIENT_ID ${client.clientId} --no-secret`,
);
