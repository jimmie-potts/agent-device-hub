## Context

A generated reply already stores the art job's request ID. Art can use it to return the exact saved artwork after another job finishes. The core owns both the configured display list and the tracked show operation. Pixoo and Tidbyt compositions use a device kind. The show operation addresses an individual configured display.

## Goals and scope

Resolve each destination before offering approval, including the browser. Retain enough information from a create-and-show request to offer a separate display approval when the artwork is ready. Cross-task references such as “that one” belong to #2029.

## Decisions

- Publish the configured target inventory through the SDK for Companions. The browser uses the core's existing art targets route with an approval view. Both readers use the same configured routing identities. A hard-coded translation would fail on an installation with two displays of the same kind.
- Read recent artwork from Art's SDK state. For an exact ID beyond that window, the runtime supplies the same bounded SDK content-manifest reader used by the core. It reads Art's retained catalog without creating a second index or issuing a command.
- Check the approved artwork's successful compositions using the Gallery's eligibility rule. The attachment read starts with its saved request ID. A global latest-art lookup could select a different result while generation is running.
- Prepare local display renditions of new reply images with the same decoder used for uploads. Store the derived compositions alongside the original under the same artwork ID. The source image is generated once. Older saved artwork advertises its retained compositions. The tracked Art preparation command requires a saved composition and never imports an old picture as a new upload.
- Bind a physical display's routing ID, kind, configuration revision and generation epoch to its proposal. Recheck the binding before dispatch. The browser destination has a fixed identity. Earlier unguarded clients keep their supported command version.
- Keep generation and presentation separate. Persist intended routing IDs with the attachment, then let the person approve presentation with the exact artwork and destinations visible. A page read, reopen or reconnect has no command effect. Use the core's existing preparation and presentation operation IDs to report progress per destination.

## Risks and verification

A display can be renamed, removed or replaced during an approval. Test a changed guard and verify no write to the replacement. A generated result can be retained beyond the recent catalog window. Resolve the originating job even when a different result is newest. A lost dispatch reply can conceal a real effect. Retain the tracked request identity and never dispatch automatically after uncertainty.

## Installation

Use the established source and release qualification process. Existing attachments without intended destinations still open from their saved references. Verify the feature through simulated devices before a selected installation and separately authorized display check.
