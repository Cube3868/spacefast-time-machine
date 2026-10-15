async (page) => {
  // Isolated, synthetic account fixtures. Nothing is sent to Spacefast.
  const check = (value, message) => {
    if (!value) throw new Error(message)
  }
  let canRestore = false,
    posts = 0,
    statusReads = 0,
    restored = false,
    outstanding = false,
    allowFinish = false
  const space = {
    id: "spc_qa",
    title: "QA Account Space",
    slug: "qa-space",
    status: "active",
    disabled: false,
    liveUrl: "https://qa.invalid",
    liveVersionId: "ver_3",
    updatedAt: "2026-10-14T18:00:00Z",
    teamSlug: "qa",
  }
  const version = (number, status = "ready") => ({
    id: `ver_${number}`,
    spaceId: "spc_qa",
    number,
    status,
    immutableUrl: `https://qa--v${number}.invalid`,
    immutableUrlStatus: "ready",
    isCurrentProduction: number === 3,
    createdAt: "2026-10-14T18:00:00Z",
    fileCount: 12,
    totalBytes: 14000,
    message: `QA version ${number}`,
    branch: null,
    gitCommitSha: null,
    publisher: "Synthetic account",
  })
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    let body,
      status = 200
    if (url.pathname === "/api/session")
      body = { connected: true, name: "Synthetic account", canRestore, pendingTickets: outstanding ? ["qa-synthetic-ticket"] : [] }
    else if (url.pathname === "/api/restore/pending")
      body = { tickets: outstanding ? ["qa-synthetic-ticket"] : [] }
    else if (url.pathname === "/api/spaces")
      body = {
        data:
          url.searchParams.get("query") &&
          !"QA Account Space"
            .toLowerCase()
            .includes(url.searchParams.get("query").toLowerCase())
            ? []
            : [space],
        pagination: { hasMore: false, nextCursor: null },
      }
    else if (url.pathname === "/api/history")
      body = {
        space: { ...space, liveVersionId: restored ? "ver_2" : "ver_3" },
        data: url.searchParams.get("cursor")
          ? [version(1, "failed")]
          : [version(3), version(2)],
        pagination: {
          hasMore: !url.searchParams.get("cursor"),
          nextCursor: url.searchParams.get("cursor")
            ? null
            : "older-fixture-page",
        },
      }
    else if (url.pathname === "/api/preview") {
      status = 403
      body = {
        error: "Secure preview unavailable in this isolated test fixture.",
        code: "fixture_unavailable",
      }
    } else if (url.pathname === "/api/restore/prepare")
      body = {
        ticket: "qa-synthetic-ticket",
        slug: "qa-space",
        expectedLive: "ver_3",
        target: version(2),
        warning: "Synthetic test. No real deployment will be changed.",
      }
    else if (url.pathname === "/api/restore/confirm") {
      posts++
      outstanding = true
      body = {
        ticket: "qa-synthetic-ticket",
        status: "submitted",
        operationId: "op_qa",
      }
    } else if (url.pathname === "/api/restore/status") {
      statusReads++
      restored = allowFinish && statusReads >= 2
      if (restored) outstanding = false
      body = {
        status: restored ? "verified" : "pending",
        operationStatus: restored ? "succeeded" : "running",
      }
    } else {
      status = 404
      body = { error: "Unknown isolated test route." }
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    })
  })
  await page.goto("http://127.0.0.1:5173")
  await page.getByRole("heading", { name: "QA Account Space" }).waitFor()
  await page.getByRole("button", { name: /v2 Ready/ }).click()
  await page
    .getByRole("button", { name: "Restore version", exact: true })
    .click()
  check(
    await page
      .getByRole("checkbox", { name: /Allow restoring versions/ })
      .isChecked(),
    "Read-only restore must require a new explicit connection with restore access",
  )
  check(posts === 0, "Read-only UI must not submit a promotion")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Load earlier versions" }).click()
  await page.getByRole("button", { name: /v1 Failed/ }).waitFor()
  check(
    (await page.locator(".version-item").count()) === 3,
    "Cursor pagination must append earlier versions",
  )
  await page.getByRole("button", { name: /v1 Failed/ }).click()
  check(
    await page
      .getByRole("button", { name: "Restore version", exact: true })
      .isDisabled(),
    "A failed deployment cannot restore",
  )
  await page.getByRole("textbox", { name: "Search Spaces" }).fill("no-match")
  await page.getByText("No matching Spaces.", { exact: true }).waitFor()
  await page.getByRole("textbox", { name: "Search Spaces" }).fill("QA")
  await page
    .getByRole("button", { name: "QA Account Space", exact: true })
    .waitFor()
  canRestore = true
  await page.reload()
  await page.getByRole("heading", { name: "QA Account Space" }).waitFor()
  await page.getByRole("button", { name: /v2 Ready/ }).click()
  await page
    .getByRole("button", { name: "Restore version", exact: true })
    .click()
  await page.getByRole("dialog", { name: "Restore this version?" }).waitFor()
  const confirmButton = page.getByRole("button", {
    name: "Confirm restore to live",
  })
  check(
    await confirmButton.isDisabled(),
    "Restore must require typed confirmation",
  )
  await page
    .getByRole("textbox", { name: "Confirm Space slug" })
    .fill("wrong-space")
  check(
    await confirmButton.isDisabled(),
    "A different Space slug cannot confirm",
  )
  await page
    .getByRole("textbox", { name: "Confirm Space slug" })
    .fill("qa-space")
  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" })
  const violations = await page.evaluate(async () =>
    (
      await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })
    ).violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  )
  check(
    !violations.length,
    `Restore dialog accessibility: ${JSON.stringify(violations)}`,
  )
  await confirmButton.click()
  await page
    .getByText(
      "Restore submitted. Waiting for Spacefast to confirm the live deployment…",
      { exact: true },
    )
    .waitFor()
  check(
    await page
      .getByRole("button", { name: "Restore version", exact: true })
      .isDisabled(),
    "Pending restore must block a second submission",
  )
  await page.reload()
  await page.getByRole("heading", { name: "QA Account Space" }).waitFor()
  await page.getByText("An earlier restore still needs verification.", { exact: false }).waitFor()
  await page.getByRole("button", { name: /v2 Ready/ }).click()
  check(await page.getByRole("button", { name: "Restore version", exact: true }).isDisabled(), "Recovered pending restore must block another submission after reload")
  allowFinish = true
  await page
    .getByText("Restore verified. The selected version is now live.", {
      exact: true,
    })
    .waitFor({ timeout: 10000 })
  check(posts === 1, "There must be exactly one promotion submission")
  check(statusReads >= 2, "Submitted must remain distinct from verified")
  await page.unroute("**/api/**")
  await page.goto("http://127.0.0.1:5173")
  return [
    "Synthetic connected UI: Space search, cursor pagination, read-only permission, failed version guard, typed confirmation, single submission, pending state and verified completion passed",
    "Restore dialog: zero automated WCAG AA violations",
    "No actual Spacefast account or deployment was changed",
  ]
}
