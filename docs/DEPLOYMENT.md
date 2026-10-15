# Deployment verification

Verified on October 15, 2026. The application, Functions, database, demo websites and source repository are hosted on Spacefast. There is no other hosting provider or external database.

- App: https://space-xx8uckgsp.space.fast/
- No-sign-in demonstration: https://space-xx8uckgsp.space.fast/?demo=1
- Source browser: https://space-xx8uckgsp.space.fast/source/
- Git repository: https://space-xx8uckgsp.space.fast/source.git
- Space: `spc_540572a009c14df3b5609a2e3275213d`
- Official CLI: `spacefast/0.5.0`, Node 24.13.0 on Windows

## Verified with the live service

- Public frontend, source browser, revision metadata and Git source return successfully. Serial HTTP Git cloning works; the source page also offers a complete main-branch Git bundle and a source archive because parallel object requests can encounter HTTP 428.
- `/api/health` executes an actual Functions database query. A signed-out `/api/session` reports `connected: false` without disclosing another user's identity.
- Public OAuth client registration succeeded with no client secret. Real owner consent, S256 PKCE callback, encrypted session recovery, Space listing and real version history work on the deployed application. Optional publish access was granted through the provider's own consent screen.
- Both actual Orbital Studio versions render in the comparison view. Desktop and mobile viewports resize by dragging, keyboard or exact dimensions, with fit scaling and reset. The public demonstration uses dated, real CLI metadata and disables mutation.
- Production response headers include CSP, frame-ancestors protection, nosniff, referrer policy and restricted browser permissions. A fresh browser sign-in reaches Spacefast's official sign-in page.
- **A full v2 → v1 → v2 round trip completed through the deployed application's own restore flow.** The live website and official CLI confirmed both changes.

## Real restore round trip

The owner authorized disposable test websites and approved rollback of Time Machine Round Trip Lab, `spc_415eaa9c7d184e36be37fdbebbf7140e`. No pre-existing user website or the shared public demo was changed.

| Step                                             | Live version                              | Actual rendered website                  | Verified UTC        |
| ------------------------------------------------ | ----------------------------------------- | ---------------------------------------- | ------------------- |
| Initial                                          | v2 `ver_bc71a72d7be14f31828dec2e0edd7047` | Verdant / A little more space to create. | 2026-10-15 14:13    |
| Restore through app, including provider approval | v1 `ver_1183db78b7394582a6b265707431a38c` | Terra / Good things take shape.          | 2026-10-15 14:15:14 |
| Return through app                               | v2 `ver_bc71a72d7be14f31828dec2e0edd7047` | Verdant / A little more space to create. | 2026-10-15 14:15:44 |

The app's status endpoint verified the operation and target live pointer before showing success. Independent `sf spaces get --space ... --json` reads matched each target, and a separate browser tab loaded the stable live URL and showed the corresponding release. Sanitized local evidence is in ignored `artifacts/restore-roundtrip.json`. The disposable site remains on v2 at https://tm-round-trip-1015.space.fast/.

### Root cause and correction

The earlier implementation stopped after the human approval receipt. The provider correctly recorded approval, but that receipt did not execute the suspended promotion. This was an integration error, not proof that Spacefast cannot roll back a version.

The official CLI reference and API contract describe continuing the identical request with its continuation token and original idempotency key after approval. The app now persists the approved phase encrypted server-side, rechecks that the live revision and ready target still match, atomically claims execution, and sends the exact promotion URL/body/key with `X-Spacefast-Continuation-Token`. The capability never reaches browser JavaScript. Concurrent status checks cannot execute it twice; ambiguous execution remains guarded rather than generating another attempt.

The live round trip verified that Spacefast accepts this handshake for promotion. Unavailable, denied, expired, changed-revision and uncertain outcomes still fail closed. There is no bypass of the provider's human approval requirement.

## Validation

48 focused backend/security tests pass. They cover PKCE/state, encrypted server-only credentials, permissions, pagination, redirect rejection, typed expiring confirmation, changed live pointers, single submission, competing confirmations, per-Space recovery, owner recovery after reconnect, logout preservation, encrypted provider continuations, serialized resume, denied approval, exact approved-request replay, approved-phase recovery, post-approval revision changes and ambiguous execution. Added coverage checks comparison projection and authorization, unavailable text reasons, linked-version identity, local OAuth return destinations, durable activity, owner/Space isolation and activity cursor boundaries.

Browser checks cover the real public demo, rendered frame content, viewport resizing, search, filters, details, navigation, reload and mobile layout. Separate synthetic account tests cover permission gates, failed versions, typed restore confirmation, one submission and verified completion. Synthetic approval checks cover review links, reload recovery, per-Space isolation and fail-closed unavailable outcomes. Synthetic checks supplement the real round trip; they do not substitute for it.

Automated WCAG AA checks report zero violations on the tested welcome, demo, details, connection, capabilities, restore and mobile views. This is not a complete manual accessibility audit. A second independent account has not been tested.

## Comparison, sharing and activity additions

The Files view uses Spacefast's documented served-deployment comparison endpoint. Both directions of the public Orbital demo were retrieved using the official CLI; each reports one modified `index.html`. `src/demo-comparison.json` holds dated real metadata and text, not fabricated changes. Live account comparisons use the same documented API through the server. Before/after content is rendered as escaped text, and binary or unavailable content retains its provider reason.

Shared links include only navigation identifiers and the selected view. They retain an exact pair after reload, load older linked versions outside list pages, and preserve their local destination through OAuth. Opening a link never grants Space access. The activity log checks current Space access, filters by owner, paginates app-owned records, and preserves unsuccessful/unverified outcomes. Earlier session records without a stored completion time are labeled accordingly.

Browser checks cover changed-file paging, unified and before/after text, escaped deployed HTML, public/private link behavior, clipboard fallback, activity pagination, and mobile layout. Automated WCAG AA checks also report zero violations for Files, sharing and activity views. Synthetic private-account tests are distinguished from live-service verification.

## Runtime details

The launch release includes a public GitHub repository, a 1200×630 card using actual demo previews, and a 39.466-second Claude-edited walkthrough with original sound effects. The player passed local desktop/mobile WCAG AA automation, and production load, playback, audio-track, seeking and all nine caption-cue checks passed. The deployed CSP rejects injected audit scripts; live media checks preserve that policy. GitHub CI passed the tests and build. The walkthrough is explicitly a read-only public demo and does not depict a restore.

- Metadata-document OAuth clients were advertised but the provider rejected its metadata fetch; the application uses verified public-client dynamic registration instead.
- The edge runtime rejects `fetch` with `redirect: error`. Supported manual mode explicitly rejects API redirects without forwarding credentials.
- Sign-in starts with same-origin URL-encoded AJAX and then navigates to a validated official authorization URL. Strict CSP and Origin checks remain enabled. Multipart form transport failed on the deployed runtime; URL encoding is verified.
- Cross-origin frame load events do not prove rendered content. Only the controlled public demo opts into a source/origin-checked readiness signal. Arbitrary websites can forbid embedding; direct immutable links remain visible.
- Continuation secrets stay encrypted and session-bound. Disconnect removes the continuation but keeps unresolved guards, so keep the session open until approval finishes.
- Temporary diagnostic routes are absent from the release.

## Publishing another release

Commit reviewed changes, run `npm test`, `npm run build`, then `npm run deploy`. The official CLI publishes a fresh staging directory to avoid packaging compiler-generated files twice. `artifacts/deployment.json` contains a sanitized receipt; `/source/revision.json` identifies the public source commit. Verify the live runtime and source after publishing. CLI credentials stay under CLI management and are never inspected, committed or copied into the app.
