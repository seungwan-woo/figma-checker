# Figma Checker — AI readiness reports for design pages

- **Author** — seungwan-woo
- **Date** — 2026-11-21
- **Status** — Revised after Goldfish review. Live reporting for the public PoC now includes approved design results. Authenticated Figma access and the baseline are pending.

## Overview

The pilot gives developers a shared view of the existing One UI Design Kit draft. It measures how often eligible containers use Auto Layout and points out layers that still use default names. The public PoC publishes a versioned JSON report and run history for designs selected for public reporting.

The main feasibility question is whether the Free seat account can read the draft with enough API quota for the desired schedule. The first metric describes use within a stated scope. Frames outside Auto Layout are not reported as violations.

## Analysis

### Input and API budget

- Use the supplied One UI Design Kit selection as the first source. Supply its URL through the `figma_link` workflow input or optional `FIGMA_URL` fallback and confirm the selected node type from the API. Reject invalid or missing targets with a clear error. Add file links alongside node links after the pilot.
- Start with one Nodes API call for `13:32` and one local traversal. For file links, later use `GET /v1/files/{key}?depth=1` to discover `CANVAS` pages and the file version. Fetch uncached page subtrees in bounded batches with `GET /v1/files/{key}/nodes?ids=…&version=…`. Reuse fetched subtrees while keeping logical selectors distinct. A page and an explicitly selected nested frame may share a fetch and still have different eligible checks. Count each eligible node once in the combined adoption metric.
- Cache normalized subtrees by file key, node ID, file version, and normalizer version. A file edit may invalidate every page entry, and checking the latest version costs a request. Keep the cache disposable and restricted to the input's audience. Honor `429` and `Retry-After` within a fixed per-run request and retry budget. Measure calls and runtime for cold, warm, and changed file versions before setting a schedule. Leave room for manual runs and retries, even when the cache is cold. Add configurable fetch concurrency and parallel page processing when expanding to full files. Bound batch size, response size, and runner time.

### Modules and report contract

Use TypeScript on a pinned Node LTS release in GitHub Actions on Linux. Keep one repository and expose reusable module entry points. Use `fp-ts` `Either` for validation, `TaskEither` for fallible I/O, and plain data types for reports. Keep the rules and scoring functions pure.

| Module | Responsibility |
|---|---|
| `figma` | Parse links, resolve targets, read snapshots, and cache normalized nodes. |
| `lint` | Register rule implementations, validate rule options, and evaluate eligible nodes. |
| `report` | Generate and validate report JSON, compute optional scores, and index run history. |
| `cli` | Load config, compose modules, and write reports. The token enters through a GitHub Actions secret. |
| `site` | Read report JSON and show page summaries, findings with Figma links, and trends. |

Start with a small validated config for sources, metric and rule IDs, and rule options. Add selectors, exceptions, and scoring settings as their use cases arrive. Evaluators consume normalized nodes and target context with explicit unknown ancestry, so unavailable page, visibility, or instance context does not silently become known. Persist `schemaVersion`, run ID and time, config hash, source file version, coverage, metrics, and rule results. A finding includes rule ID and version, status (`pass`, `fail`, or `skip`), node ID, page ID when known, description, and a Figma deep link. Operational errors belong to the run status.

### First metric and first rule

- **Auto Layout adoption** is `enabled / eligible`. The proposed denominator is visible `FRAME` and `COMPONENT` containers with at least one visible direct child inside the selected subtree. Include nodes nested under component sets. Exclude instance subtrees and hidden subtrees within the fetched scope. For a direct node link, label visibility as relative to the fetched subtree if ancestors are unknown. `HORIZONTAL`, `VERTICAL`, and `GRID` count as enabled. `NONE` or an omitted mode counts as disabled. Show the numerator and denominator alongside the percentage, including when aggregating pages. Show distinct states for zero adoption, zero eligible containers, and unavailable data. If some targets fail to load, mark coverage as partial and omit a combined figure. Use fixtures for hidden, empty, instance, overlapping-target, and zero-denominator cases.
- **Default layer name** is the first advisory lint. Check the selected node and each descendant, including hidden layers and instances. Match common English default names such as `Frame 12`, `Rectangle 1`, and `Group 3` regardless of node type. The matching pattern can be configured for other locales. The finding includes the current name, a suggestion to describe the role or content, and a Figma link. Version 2 keeps the existing rule ID so the dashboard can distinguish it from earlier reports.

For example, in a synthetic selection whose root is `Frame 12`, adoption is `3 of 4 (75%)`. The naming rule links the root and nested layers that match the default pattern. If the real target yields no findings, keep that result and demonstrate the rule with the fixture.

### Score, schedule, and history

- Keep the composite score off in the pilot. Show Auto Layout adoption as a descriptive percentage and the advisory findings as a separate list. If scoring is enabled later, apply an explicit rule policy and show `pass / (pass + fail)` or a defined `PASS` or `FAIL` threshold with its denominator and policy. Exclude explicit skips. Show “not assessed” when there are no evaluated checks.
- Use `workflow_dispatch` first with the `figma_link` input and `FIGMA_TOKEN` secret. Summarize request and cache counts, stage durations, coverage, and typed failures in the Actions run. Keep credentials and raw Figma responses out of published reports.
- Add `schedule` after the quota check. When durable Pages history is needed, give writers a shared concurrency group, update a versioned run record and index together, and have a dependent Pages job build from that exact revision. Make retries safe and keep a defined history window. Show the latest attempt, last successful scan, and published report age. Use Actions failure notifications for job failures and show staleness even if a scheduled run never starts. Group trend points by stable target scope and metric or rule definition, including denominator policy. Figma file versions identify observations and change between comparable runs. Test the reader with retained reports before changing the report format.
- The public PoC can publish live metrics and linked findings for designs approved for public reporting. Figma's file permissions still apply when a reader follows a link. For future private designs, use separate access-controlled output and history.

## Goals vs. Non-Goals

- **In scope** — Existing One UI Design Kit draft, configurable file or node inputs, page fan-out, versioned caching, Auto Layout adoption, one advisory naming rule, Figma deep links, scheduled reports, and a trend view.
- **Later** — Variable binding and component checks, advanced scoring, private production publication, and LLM-assisted findings. A later async rule adapter can use the same result schema with model provenance and its own cache and budget. Keep those findings out of the score until a policy defines how to use them.

## Alternatives Weighed

| Approach | Trade-off |
|---|---|
| One Actions job with parallel page evaluation | Proposed for the first version. One place to reuse requests, enforce quotas, and aggregate results. |
| One Actions matrix job per page | Useful for large workloads. Duplicated setup and cross-job coordination make it harder to share quota and cache state. |
| Actions artifacts for all history | Easy to start with. Artifact retention and access make it a poor source for long-lived Pages trends. |
| Figma plugin as the primary collector | Can help with rate-constrained files. It changes the unattended REST workflow, so keep it as a fallback if the Free seat feasibility check fails. |

## Key Decisions & Staging for Next Steps

1. **Feasibility** — Read the selected draft node with the Free seat token in a manually triggered Linux runner. Confirm the target type, response status, and available quota signals. The workspace could not reach either the design URL or the REST endpoint through its proxy, so authenticated access remains untested.
2. **Baseline** — Compute Auto Layout adoption from the selected node and cross-check counts against a small hand-audited sample. Confirm that empty scopes and API failures do not render a percentage.
3. **First advisory rule** — Verify expected naming matches and exclusions with synthetic fixtures. Have an internal developer review the live report and open a matching Figma link.
4. **Repeatability** — Confirm cache reuse on two runs of the same version and test cold and changed versions. Once the quota can sustain the cadence, test two history points, recovery after a failed deploy, and Pages freshness.

## Initial Goldfish Review

All seven lenses completed. The initial review assumed internal-only reports. The PoC owner later approved public reporting for this repository. The findings led to a single-node manual pilot, separate retrieval and selector logic, and distinct failed, successful, and published run states. Confirm the Free seat quota before enabling automatic schedules.

References: [Figma REST API specification](https://github.com/figma/rest-api-spec/blob/main/openapi/openapi.yaml), [Figma API rate limits](https://developers.figma.com/docs/rest-api/rate-limits/), [GitHub Actions schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
