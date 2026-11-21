# Figma instance source reference check

## Problem and outcome

Developers reviewing a design need to find instances whose source component cannot be identified from the checked Figma snapshot. Today the checker keeps the layer type and name, but drops the instance's `componentId` and the response's `components` map. A new advisory reports the unresolved reference. The live report provides a link for an ordinary node ID and describes what the current snapshot confirms.

## Scope

- Inspect `INSTANCE` nodes in the selected subtree, including nested and hidden instances. Other node types are outside this rule. The feature works from the existing Nodes API response with `file_content:read` access and does not increase the number of Figma requests.
- Report counts for all resolved, unresolved, and not checked instances. `0` instances is a normal result. Show up to 100 unresolved advisory details per scan in document order and report how many details were omitted. The existing scan and the other rules continue if component metadata is unavailable.
- The public live workflow can expose the affected instance ID, reason, and Figma link, including for hidden and nested instances. Use a generic instance label in the Actions artifact, Pages, and downloadable history. Public fixture output shows the node ID as plain text.
- Source checks do not identify detached ordinary frames or certify that a component is still published. Checking a library by key, checking approved libraries, and comparing design versions are separate changes. The advisory is excluded from scoring.

## Evidence and classification

Use `nodes[requestedId].components` from `GET /v1/files/{key}/nodes`. The Figma adapter preserves `INSTANCE.componentId` and normalizes the map's own entries to `valid` or `invalid`. A map value is valid when its direct `key` property is a nonblank string. Represent a missing or unusable map as `null` and keep an empty map as an available map with no entries. The pure rule looks up `INSTANCE.componentId` by exact map key. A valid `componentId` is a string with at least one non-whitespace character. Preserve its original value for matching. The instance's own node `id` identifies the affected layer in the finding and its Figma link. The adapter discards the raw metadata after normalization.

| Snapshot evidence | Result |
|---|---|
| The instance has a valid `componentId` and the map contains usable metadata for it. | `resolved` |
| The map is available, but `componentId` is absent, not a string, or blank. | `unresolved`, with `missing_component_id`. |
| The map is available and `componentId` is valid, but the matching entry is absent or lacks a usable component key. | `unresolved`, with `missing_component_entry` or `invalid_component_entry` as appropriate. |
| The `components` map is absent or unusable. | `not_checked`, with no per-instance advisory. |

The UI calls the result “원본 확인 불가” when unresolved. A partial response, access boundary, or API limitation can prevent resolution. The advisory wording leaves the cause open. The rule does not infer a broken or detached link from an absent map entry.

## Proposed implementation

1. Extend the normalized snapshot in `src/figma.ts` with the instance reference IDs and the selected envelope's normalized component map. Validate these fields independently of the layer tree. An invalid entry affects only instances that reference it.
2. Evaluate the lookup in a pure rule with ID `instance-source-reference`, version 1. The existing config can disable it with `rules.instance-source-reference.enabled: false`. Its summary records `evaluated = resolved + unresolved`, `resolved`, `unresolved`, `notChecked`, and `omittedDetails`. An unresolved finding uses `status: 'skip'` and `severity: 'advisory'` with a rule ID, allowlisted reason code, node ID, generic instance label, and canonical Figma link when available. A disabled rule is distinct from an enabled rule with no instances.
3. Extend the report and public projection additively. Keep the existing JSON schema version and display the instance-source rule as unavailable for older reports without its summary. Locate summaries and findings by rule ID in Pages and history. Keep naming version labels and grouping stable if summaries change order or one is absent. The latest report shows separate instance-source counts and details. Keep the existing live publication gate. A completed live report with an invalid `targetUrl` is rejected before projecting its details. In either mode, publish instance details only when the finding's node `id` passes canonical Figma node ID validation. Drop an invalid detail from both HTML and downloadable JSON, increment `omittedDetails` once, and preserve the aggregate counts and valid siblings. Generate live links from the validated report target and finding node ID. Preserve the target path, including any branch path, set `node-id` to the affected node, and discard other query parameters. Public fixture details contain no links. Escape rendered fields. The naming rule still displays the name it matched. Instance-source outputs exclude raw component metadata, credentials, arbitrary instance names, and resolved source keys.
4. Preserve counts when limiting details. For an incoming attempt within the row limit, measure the remaining serialized UTF-8 budget out of 32 MiB after accounting for newer retained attempts. Keep those newer attempts unchanged. Retain the longest prefix of the incoming instance details in document order that fits, including its summary and updated `omittedDetails`. Measure the exact output of the history writer, including brackets, newlines, separators, and the final `omittedDetails` value. Preserve all counts. Keep the existing rejection if the attempt falls outside the row limit or if its report still exceeds the remaining budget with no instance details.
5. Keep virtual instance IDs in the counts and detail lists. Display them as text and omit their finding links from public live HTML, JSON, and artifacts even when the same node also triggers the naming rule. Enable such links only after comparing a generated link with an editor-copied link and verifying that it opens the intended nested instance. Canonical links for ordinary IDs remain available.

## Alternatives

- **Query the component endpoint for each source key.** It may provide stronger evidence about published assets, but requires `library_assets:read`, depends on source access, and consumes quota. Defer it until the snapshot check demonstrates a need.
- **Inspect source links in an editor plugin.** The plugin can query the main component in the editor, but it needs an editor session. It does not fit the current unattended GitHub Actions workflow.
- **Match visible names or geometry.** A renamed or duplicated layer can look identical with a different source. These signals would lower confidence when an explicit `componentId` is available.

## Risks and acceptance checks

- Use the existing bounded response and one traversal with map lookups. A missing map must not fail the whole scan or generate a false list of broken links.
- Verify local and remote matches, nested and hidden instances, an unresolved reference, an empty map, a missing map, and invalid metadata with realistic Nodes API fixtures. Include a resolved instance whose node `id` differs from its `componentId` and whose map contains only the `componentId`, with a direct `key` on the map entry. Cover whitespace-only and non-string IDs. Check that ordinary frames and layers with virtual IDs do not count unless their type is `INSTANCE`.
- Verify that a fixture with more than 100 unresolved instances keeps its full counts, reports omitted details, and still builds the site. Test two attempts near the shared byte limit. The newer attempt stays unchanged, while the older incoming attempt keeps its summary and as many details as fit. A serialized output of exactly 32 MiB fits. One byte beyond the cap triggers trimming or rejection. Test the existing rejection when the summary and baseline still exceed the remaining byte budget or the attempt falls outside the row limit.
- Verify the existing Auto Layout and naming results, config disablement, and loading reports written before the new rule. Append a report, reload it from history, and build the site with the two rule summaries in either order and with either summary absent. Check that unresolved instance counts and reasons survive and naming totals and grouping stay accurate.
- Verify generic labels, allowlisted reason codes, and escaped output in the public report and downloadable history. Test that an invalid completed-live target rejects the report. Separately, project a report containing a malformed finding node ID and a valid sibling to Pages and through history append and reload. The malformed value is absent from the public JSON and HTML, the valid sibling and counts remain, and `omittedDetails` increases only once.
- Supply a finding URL with the same file key and node ID as expected but a different pathname. The output must use the report target's path. Verify that both fixture details and live virtual IDs have no links and that the virtual IDs still round-trip through the local URL encoder and parser. Confirm no extra requests with the fixture transport. Compare one real scan with the Figma editor where access allows. Confirm editor behavior separately before enabling links for virtual IDs.

References: [Figma REST Nodes API](https://github.com/figma/rest-api-spec/blob/main/openapi/openapi.yaml#L200), [InstanceNode schema](https://github.com/figma/rest-api-spec/blob/main/openapi/openapi.yaml#L4704), [published component lookup](https://github.com/figma/rest-api-spec/blob/main/openapi/openapi.yaml#L1415).
