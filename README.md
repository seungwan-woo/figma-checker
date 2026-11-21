# Figma Checker pilot

The pilot reads one Figma page, section, or frame selection and publishes a JSON report and run history to the public proof-of-concept dashboard. It needs only Figma read access.

## Try the synthetic report locally

Use the version in `.node-version`.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
FIGMA_URL='https://www.figma.com/design/synthetic/Example?node-id=13-32' \
  npm run check:figma -- --fixture test/fixtures/pilot-nodes.json
```

Open `reports/report.json`. The example yields **75% adoption (3 of 4 containers)** and one advisory for `Frame 12`. The URL in the synthetic finding is an example of the link format.

## Publish a live Figma report

1. Under **Settings → Secrets and variables → Actions**, add `FIGMA_TOKEN` as a **Repository secret**. Use a Figma personal access token with `file_content:read` from an account that can read the design.
2. Open **Actions → Figma pilot → Run workflow** on `main`, choose `live`, and enter a Figma link in `figma_link`. Use a design approved for public reporting. The link must include `node-id`. A repository secret named `FIGMA_URL` is an optional fallback for an empty input.
3. Open [GitHub Pages](https://seungwan-woo.github.io/figma-checker/) to see the latest successful live report and the history by target. The run also provides a complete JSON artifact named `figma-report-live-<attempt>`. Opening a Figma link still requires the user's own access to Figma.

The public `report-history` branch keeps one entry per Actions run attempt. The dashboard history shows the latest 100 attempts within a 32 MiB budget. Writing the same attempt twice does not add a duplicate. A failed scan records an error without a percentage and marks the scan job as failed. Pages still publishes the updated history and shows the latest successful live report in the retained window. Use `fixture` to test the full pipeline without calling Figma.

To run locally with these environment variables already set, run `npm run build` then `npm run check:figma`. Pass `--config FILE` or `--output FILE` to change the config or output path. The process exits with code `1` for an operational error and writes a JSON report with a safe error code. Advisory findings leave the run successful. A `FIGMA_RATE_LIMIT` error includes the reported waiting time when Figma provides it. The manual pilot sends one request per run.

## Read the result

- `metrics` shows Auto Layout adoption for visible, nonempty frame and component containers. Instance subtrees are excluded. A `null` percentage means there were no eligible containers. A failed scan has `status: "error"`.
- `findings` links visible top-level frames with a name such as `Frame 12` back to Figma. With a frame link, the naming rule checks the selected frame. The metric also examines its eligible descendants.
- `figma-checker.config.json` configures the report alias and the naming rule pattern or `enabled` flag. A private config can supply `url`; `FIGMA_URL` overrides it.

## GitHub Pages preview

Run `npm run build:pages` and serve `pages-dist/` to preview the report and its JSON downloads. If available, `reports/history.json` supplies the history. On relevant pushes to `main`, the workflow rebuilds the site from saved history. In **Settings → Pages**, choose **GitHub Actions** as the source.

The checked-in fixture supplies the preview before a successful live run. The [concept brief](concepts_brief.md) covers future file-wide scans, scheduled updates, and optional scoring. Measure Free seat quota before choosing a schedule.
