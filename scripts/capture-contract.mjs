import { writeFile } from "node:fs/promises";
const j = await (await fetch("https://api.spacefast.com/openapi.json")).json();
const paths = {};
for (const p of [
  "/v1/me",
  "/v1/spaces",
  "/v1/spaces/{spaceId}",
  "/v1/spaces/{spaceId}/versions",
  "/v1/spaces/{spaceId}/versions/{versionId}",
  "/v1/spaces/{spaceId}/versions/{versionId}/preview-session",
  "/v1/spaces/{spaceId}/versions/{versionId}/promote",
  "/v1/operations/{operationId}",
]) {
  const methods = ["get", "post"].filter((method) => j.paths[p][method]);
  paths[p] = Object.fromEntries(
    methods.map((method) => {
      const o = j.paths[p][method];
      return [
        method,
        {
          operationId: o.operationId,
          summary: o.summary,
          description: o.description,
          parameters: o.parameters?.map(({ name, required, schema }) => ({
            name,
            required,
            type: schema?.type,
          })),
          requestBody: o.requestBody?.content?.["application/json"]?.schema,
        },
      ];
    }),
  );
}
await writeFile(
  "docs/api-contract.json",
  JSON.stringify(
    {
      source: "https://api.spacefast.com/openapi.json",
      version: j.info.version,
      retrievedAt: new Date().toISOString(),
      paths,
    },
    null,
    2,
  ),
);
const discovery = await (
  await fetch(
    "https://api.spacefast.com/.well-known/oauth-authorization-server",
  )
).json();
await writeFile(
  "docs/oauth-discovery.json",
  JSON.stringify(discovery, null, 2),
);
