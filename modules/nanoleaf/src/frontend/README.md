# Retained Nanoleaf editor source

Source: [codex-nanoleaf](https://github.com/jimmie-potts/codex-nanoleaf), commit
`c711e1812d6871952562e9070e20bdebe120db3a`. These files were read from that Git tree,
not from the installed bridge. The SVG reference assets and their README are copied
unchanged. Prism creates the same artwork with its DOM factories; it does not fetch
these reference files.

`wall.html` supplies `markup.js`, `wall.css` and `wall.js`. The extraction keeps the
wall controls, selection, task inspector, local preferences, Prism artwork and
assembly behavior. It replaces page-wide selectors with host-scoped selectors,
scopes CSS and animation names, flattens its layers to preserve precedence inside
the shared shell, and makes event listeners, timers, observers and
renderers disposable. Document landmarks become local containers. The old server
connection, token, polling and installed-Hub link are removed. Elapsed labels use a
local presentation timer. Dynamic text uses DOM text nodes; Codex links are checked
against the exact Desktop thread UUID scheme before navigation.

`prism.js`, `prism-adapters.js` and `prism-labels.js` retain their algorithms with
ES module exports in place of global wrappers. Prism's global capability tests use
`window`; two unused initial values and an unused constant were removed. No runtime
or Node implementation is imported by this browser entry.

`index.tsx` mounts the controller, follows `device` and `nanoleaf-wall` through the
shell context, and reads saved connector geometry through the authenticated module
content route. `model.ts` translates records and existing wall actions. The shared
Command component owns request identity, completion, uncertainty and reload recovery.
Read-only and stale views keep local inspection available while disabling writes.

The package's `./frontend` export points its import to `src/frontend/index.tsx` and
its types to `dist/src/frontend/index.d.ts`. This follows the fixed frontend build's
source-entry convention: esbuild bundles TSX, CSS and retained JavaScript directly.
TypeScript checks the strict host and adapter; `wall.d.ts` declares the narrow
mount/update/dispose boundary. There is no asset-copy build, runtime loader or
second frontend connection.

## Upstream SHA-256 inventory

These hashes describe the source files before extraction or ESM adaptation.

| Source path | SHA-256 |
| --- | --- |
| `bridge/wall.html` | `4683977e31f05d2d82a3ddcd7faae4605bec606da0f31e623559d92f83957256` |
| `bridge/prism.js` | `b4335c940c608216e5e44888e7076136e2dcc96b3be965fe22efd038b1315d45` |
| `bridge/prism-adapters.js` | `3b7ae4523c1f5e0b9b555aa2f42d2327b0f0acdd31864de454c2eac505a7cbb9` |
| `bridge/prism-labels.js` | `15b2a1e1e5e312cf938f45c787e71a5cc8bc36a801371cf398fa1925f6e66470` |
| `bridge/assets/prism/README.md` | `899c331401e664fa99514a053b3650bdb2a5ce7eb43a54d38488a78e0c44e517` |
| `bridge/assets/prism/center-spark.svg` | `8796d1280f38ef0d40e917fca9e95987be258ac920f1d8eaa3ac299e1bd26b6b` |
| `bridge/assets/prism/connector-rim-0.svg` | `361ee0c0a38f78b6f8fa6baaaaf5995fb9dc91e6a13c9e254b500391cb7c951a` |
| `bridge/assets/prism/connector-rim-1.svg` | `2bc6a8cf449876e9e31e73bb612c4b2e231b253b1e94f2b55ddae7ec4612ec92` |
| `bridge/assets/prism/connector-rim-2.svg` | `e800eb1a6c6a249973af480564c70bbd3f2d1f3b5d33e71b6e1f49b260b6462c` |
| `bridge/assets/prism/connector-rim-3.svg` | `40fa0a0969f2581f7f5d690b5de34a317e24b188cdf93ef86a5d4e569d833796` |
| `bridge/assets/prism/connector-rim-4.svg` | `bf7fb43c8db01d586e32f044e4a6508585ec12bb0a10b7fa8b90028c30264235` |
| `bridge/assets/prism/connector-rim-5.svg` | `48a0f322e05c91c94bc13c2882086a3e6d051b57cfd053d65e845be0c8f0e688` |
| `bridge/assets/prism/connector.svg` | `342d40890f02f2ac4122fddfceaf7ce70354127c13eff415735eadec9d9a16bf` |
| `bridge/assets/prism/line-two-zones.svg` | `784fb27e8bc045d3aa8b9c95b6091c35af27fa346da40d591e57358e7c7d4ac6` |
| `bridge/assets/prism/luminous-number.svg` | `0162399f83138a1514b1d0a9fe0b628e0cf54832c694dcc66f99589733332e8c` |
| `bridge/assets/prism/tube-crystal.svg` | `3e7de00099d1d20e58bddf5e96569e5127d86bafd1c4dafd7b65df35437dbbbe` |
| `bridge/assets/prism/tube-shell-back.svg` | `3c8011e5defc1eceb67554e9bfd8aab1584407f94c609ccc7766628e122e189a` |
| `bridge/assets/prism/tube-shell-front.svg` | `c117a56fd83e50887af98452d0f8b9a8738cab87affef3342a82a245137fbb22` |
| `bridge/assets/prism/zone-a-light.svg` | `751533a1053792eb64de625a5f5194354955727da1365e0067f48c9594d762ac` |
| `bridge/assets/prism/zone-b-light.svg` | `c25e67c1cc0b35720c9043bdb725dc226463fd7a36bd34b8bacd0a809af29285` |
