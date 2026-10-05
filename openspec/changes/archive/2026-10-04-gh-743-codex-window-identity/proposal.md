## Why

In the [#743](https://github.com/jimmie-potts/agent-device-hub/issues/743) owner trial, a CHOMPI key brought Codex Desktop to the front on the right task, yet the bridge logged `foreground-mismatch` and failed closed. A read-only probe showed why: Codex's window process, `ChatGPT.exe` under `C:\Program Files\WindowsApps\OpenAI.Codex_26.930.3930.0_x64__2p2nqsd0c76g0\app\`, runs without package identity, so `GetPackageFamilyName` reports none. Claude Desktop's window process does carry its identity. The #740 report took Codex's family from the installed package rather than from its window process, so the gap went unnoticed.

## What Changes

- When the foreground window's process has no package identity, the Windows adapter derives the package family from the installed package folder its image runs from, directly under `<Program Files>\WindowsApps`. The folder name is parsed as `Name_Version_Architecture_ResourceId_PublisherId` and the family is `Name_PublisherId`. A real package identity always wins, and any other location yields none.
- Document it in the bridge README and the qualification report, and amend "OS adapter contract version 2".

## Capabilities

### Modified Capabilities

- `chompi-bridge`: foreground package family falls back to the installed package folder.

## Impact

Bridge package only. Codex focus and the client-process tracking for the version gate now see Codex's window. Installation means reinstalling the bridge on Windows, and the live check is part of the #743 trial.
