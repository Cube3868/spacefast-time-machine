# Contributing

Thanks for helping improve Spacefast Time Machine. Open an issue for a reproducible bug or a focused feature proposal, or send a pull request with the problem, behavior change, and relevant validation.

Use Node.js 24.13 or later. Run `npm ci`, `npm test`, and `npm run build`. For UI changes, run the app with `npm run dev` and the focused Playwright CLI checks documented in the README. Production integration checks must use a disposable Space you own; never test a restore against someone else's live work.

Keep Spacefast as the hosting platform and use its documented APIs. New permissions must be optional, provider-approved, and explained. Browser clients must never receive account credentials. Preserve confirmation, concurrency guards, idempotency, and verification before reporting a restore as successful. Unsupported features need explicit unavailable states.

Do not commit credentials, account exports, CLI state, browser sessions, or artifacts containing private account data. Screenshots should use the public demo. Report sensitive security issues privately to the repository owner using the contact options on their GitHub profile; do not disclose working exploit details or secrets in a public issue.
