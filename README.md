# Figma Checker pilot

The pilot reads one Figma page, section, or frame selection and writes a JSON report for internal developers. It works from an existing design draft and needs only read access.

## Try the synthetic report locally

Use the version in `.node-version`.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
FIGMA_URL='https://www.figma.com/design/synthetic/Example?node-id=13-32' \
  npm run check:figma -- --fixture test/fixtures/pilot-nodes.json
```

Open `reports/report.json`. The example yields **75% adoption (3 of 4 containers)** and one advisory for `Frame 12`. The URL in the synthetic finding is an example of the link format.

## Run against the Figma draft

1. Put the workflow on the default branch of a **private GitHub repository** that the pilot developers can access. The public repository can run the synthetic mode.
2. Under **Settings → Secrets and variables → Actions**, add `FIGMA_URL` and `FIGMA_TOKEN` as **Repository secrets**. Use the One UI Design Kit selection link for `FIGMA_URL` and a Figma personal access token with `file_content:read` from an account that can read the draft. A link must include `node-id` in the pilot.
3. Open **Actions → Figma pilot → Run workflow**, choose `live`, and download `figma-report-live`. Check that a developer can read the artifact and open a finding's Figma link with their own Figma access. Keep the repository private while any live run artifacts are retained.

To run locally with these environment variables already set, run `npm run build` then `npm run check:figma`. Pass `--config FILE` or `--output FILE` to change the config or output path. The process exits with code `1` for an operational error and writes a JSON report with a safe error code. Advisory findings leave the run successful. A `FIGMA_RATE_LIMIT` error includes the reported waiting time when Figma provides it. The manual pilot sends one request per run.

## Read the result

- `metrics` shows Auto Layout adoption for visible, nonempty frame and component containers. Instance subtrees are excluded. A `null` percentage means there were no eligible containers. A failed scan has `status: "error"`.
- `findings` links visible top-level frames with a name such as `Frame 12` back to Figma. With a frame link, the naming rule checks the selected frame. The metric also examines its eligible descendants.
- `figma-checker.config.json` configures the report alias and the naming rule pattern or `enabled` flag. A private config can supply `url`; `FIGMA_URL` overrides it.

The [concept brief](concepts_brief.md) covers the later file-wide scan, scheduled history, GitHub Pages, and optional scoring. Measure Free seat quota in the private pilot before choosing a schedule.
