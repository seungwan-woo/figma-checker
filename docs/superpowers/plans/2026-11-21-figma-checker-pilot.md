# Figma Checker Pilot Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for inline execution. Verify each task against the brief.

**Goal:** Produce the first internal report from a configured Figma node, with Auto Layout adoption and one advisory naming rule.

**Architecture:** A Figma adapter validates a Nodes API response before a pure evaluator computes adoption and findings. The CLI joins these modules and emits a versioned report. A manually triggered Linux workflow runs either the synthetic example or the live check.

**Tech stack:** Node 24, TypeScript, `fp-ts` `Either` and `TaskEither`, Node's test runner, GitHub Actions.

**Spec:** `concepts_brief.md`, pilot stages 1–3.

## Global constraints

- Start with a node or page selection and one read-only API request. File discovery, page fan-out, versioned cache, optional scoring, Pages, and scheduling are later stages in the brief.
- The current GitHub repository is public. Keep the real draft URL in runtime configuration, and permit the workflow's live mode only in a private repository. A synthetic fixture exercises the public path.
- Report output includes numerator, denominator, coverage scope, Figma version, and direct links for naming findings. An error report contains no metric or finding results.

## Review focus

- A node omitted from a 200 response is unavailable rather than a zero-denominator success.
- Hidden and instance subtrees cannot inflate adoption. The naming rule follows page and section boundaries.
- A 429 surfaces `Retry-After` via structured fields and does not spend more quota on the first manual pilot.
- Authentication and request errors must not copy remote response text, tokens, or private URLs into Actions logs.
- The report distinguishes 0% from an empty eligible set and includes the selected frame's deeper eligible containers in the metric only.

## Tasks

- [x] Write and run the synthetic CLI acceptance test. Expect `3 / 4` adoption and one finding for `Frame 12`; the initial run fails because the CLI does not exist.
- [x] Implement `parseFigmaTarget` and `decodeSnapshot` in `src/figma.ts`. Expose `fetchSnapshot` with an injected `fetch`-compatible transport and a bounded timeout and response size. Implement `evaluateSnapshot` in `src/lint.ts`. Verify selection, coverage, naming, and API error behavior.
- [x] Validate config and compose the run in `src/cli.ts`. Accept `--config`, `--fixture`, and `--output`. Require `FIGMA_TOKEN` for live reports and accept the source URL through `FIGMA_URL`. Write the report as JSON with a nonzero exit status on failure.
- [x] Add the manual workflow and usage instructions. Verify the synthetic workflow inputs locally, CLI exit behavior, TypeScript compilation, and workflow syntax.
- [ ] Run against the real draft once a private repository and its `FIGMA_URL` and `FIGMA_TOKEN` secrets are available. Verify artifact access for an internal developer and use the observed API allowance to determine a schedule.
