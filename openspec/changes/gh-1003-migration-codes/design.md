## Context

Two offline migration tools (#931, #933) and two runtime modules (#843, #844) each recognized a full disk on their own, and the tools named a leftover log differently. The installer (#935) reads the tools' lines and exit codes.

## Decisions

- **`destination-not-clean`.** It matches `source-not-clean`, which both tools use for the source's own leftover log or journal, so one word pair covers both ends.
- **The full-disk test lives in the SDK.** Modules may import only the SDK and the contracts package (`bunny/module-boundary`), and both tools already depend on the SDK, so the SDK is the one place every user can import it from. It reads codes only, `errcode`'s low byte and `code`, on the error and up to seven causes, so a cycle or a long chain ends the walk; its docstring says seven causes, where the copies said eight.
- **Keep the signal listeners until the first signal.** A signal that arrives between the tool's line and the process's exit then aborts a run that has finished, and the process exits with the code the line reports. Removing the listeners after the line, as the Pixoo entry point did, would let such a signal end the process by the signal, with an exit code that disagrees with the line. A probe test holds a tool open after its line and sends each signal.
- **Not shared.** The tools' state-directory and fresh-destination checks differ (the Pixoo tool refuses a module folder others may open before it writes; the Nanoleaf tool's `openModuleFolder` refuses it after it took the lease, exit 4), so sharing them is more than a plain import. The README's Nanoleaf table states those codes' exit 4.

## Risks / Trade-offs

- `openModuleDatabaseFile` now also treats `ENOSPC` and a wrapped full disk as a full disk when WAL mode cannot be set; SQLite reports a full disk there as `SQLITE_FULL`, so the outcome is the same.
