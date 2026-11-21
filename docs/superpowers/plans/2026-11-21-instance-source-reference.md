# Instance Source Reference Implementation Plan

> **For agentic workers:** Execute inline with test-driven development, then verify the CLI, Pages, and history together.

**Goal:** Report which instance sources can be identified from the existing Figma Nodes response.

**Architecture:** The Figma adapter normalizes reference evidence. A pure rule classifies instances. Pages and history validate and project the results alongside existing rules.

**Spec:** `docs/designs/instance-source-reference.md`, accepted at the Goldfish review cap.

- [x] Test and implement exact source lookup, missing map versus empty map, config disablement, and the 100-detail cap.
- [x] Test and implement public rule-ID grouping, validated ordinary-node links, virtual IDs as text, and older report support.
- [x] Test and implement exact history byte accounting and count-preserving detail trimming for an incoming attempt.
- [x] Run the full test suite, build Pages, and verify the CLI and history report round trip.
- [ ] Check a real Figma scan on `main` after merge.
