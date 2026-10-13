## 1. Observe and correct the return boundary

- [x] 1.1 Add a synthetic collector regression with a record end before returning finishes; demonstrate the old code fails to expose eligible samples and capture a candidate map.
- [x] 1.2 Keep returning originals while stopping its advancement of the cleaning association boundary; verify the same regression passes with unchanged unverified map labeling.
- [x] 1.3 Verify returning-only observations cannot attach a historical record or capture its map, and the existing delayed, ambiguous, gap and restart cases remain passing.

## 2. Validate and document the bounded source correction

- [x] 2.1 Update the module guide to explain the return boundary and historical limitation; inspect that originals, unknown clocks and missed captures are preserved.
- [x] 2.2 Run the required build/type/lint, Roborock module/consumer/browser, affected event/SDK/runtime/MCP/dashboard and workflow checks with successful results and preserve the actual specification inventory.

After all source tasks pass, synchronize and archive this change before freezing the independent source-review candidate. Installation and the actual app/map comparison remain separate #376 AC6 obligations.
