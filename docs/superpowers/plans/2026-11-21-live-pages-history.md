# Live Pages History Implementation Plan

> **For agentic workers:** Validate changes with the functional tests before publishing the PR.

**Goal:** A manual Figma run publishes its report and retained history to the public proof-of-concept dashboard.

**Architecture:** Keep the CLI scan and public report projection separate. The default-branch workflow accepts one Figma node link, upserts an attempt in `report-history`, builds the view, and deploys it in the same run.

**Constraints:** Keep the token in Actions Secrets and never store raw Figma payloads. Manual fixture runs and live runs use separate history scopes. Use the existing single-node parser and defer scheduling and file-wide fan-out.

- [x] Add tests for multiple targets, failure retention, retry idempotency, and public Figma links.
- [x] Add a canonical target to CLI reports and implement the allowlisted history and Pages rendering.
- [x] Consolidate the deployment into the Figma pilot workflow, granting history writes only to the manual default-branch job.
- [x] Verify the test suite, sample deployment bundle, and a sequence of local history updates. Validate `concurrency.queue` against the current GitHub Actions documentation because actionlint 1.7.12 does not yet recognize it.
- [ ] After merge, dispatch a real scan and confirm the history branch and Pages deployment.
