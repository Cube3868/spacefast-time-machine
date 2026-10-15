export type ComparisonView = "preview" | "files" | "details";
export function readComparisonLink(search: string) {
  const q = new URLSearchParams(search);
  const view = q.get("view");
  return {
    demo: q.get("demo") === "1",
    spaceId: q.get("space")?.slice(0, 128) || "",
    versionId: q.get("version")?.slice(0, 128) || "",
    compareId: q.get("compare")?.slice(0, 128) || "",
    view: (["preview", "files", "details"].includes(view || "")
      ? view
      : "preview") as ComparisonView,
  };
}
export function comparisonPath(link: {
  demo: boolean;
  spaceId: string;
  versionId: string;
  compareId: string;
  view: ComparisonView;
}) {
  const q = new URLSearchParams();
  if (link.demo) q.set("demo", "1");
  q.set("space", link.spaceId);
  q.set("version", link.versionId);
  q.set("compare", link.compareId);
  q.set("view", link.view);
  return `/?${q}`;
}
