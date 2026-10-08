## Context

Two offline migration tools (#931, #933) and two runtime modules (#843, #844) each recognized a full disk on their own, and the tools named a leftover log differently. The installer (#935) reads the tools' lines and exit codes.

## Decisions

- **`destination-not-clean`.** It matches `source-not-clean`, which both tools use for the source's own leftover log or journal, so one word pair covers both ends.
- **The full-disk test lives in the SDK.** Modules may import only the SDK and the contracts package (`bunny/module-boundary`), and both tools already depend on the SDK, so the SDK is the one place every user can import it from. It reads codes only, `errcode`'s low byte and `code`, on the error and up to seven causes, so a cycle or a long chain ends the walk; its docstring says seven causes, where the copies said eight.
- **Keep the signal listeners until the first signal.** A signal that arrives between the tool's line and the process's exit then aborts a run that has finished, and the process exits with the code the line reports. Removing the listeners after the line, as the Pixoo entry point did, would let such a signal end the process by the signal, with an exit code that disagrees with the line. A probe test holds a tool open after its line and sends each signal.
- **One fresh-module check, before anything is created.** The Pixoo tool refused a `modules/` or module folder that others may open before it wrote, with exit 3; the Nanoleaf tool's `openModuleFolder` refused it only after the lease, with exit 4, and its lease had already made its lock file in that folder, through a link if `modules/` was one. Both tools now call the runtime's `freshModule(stateDir, name)` (`src/state.ts`), which creates nothing, refuses such a folder with `module-folder-not-private` as `openModuleFolder` does, and says whether the module has any file yet. They call it before they create anything and again under the lease, so the Nanoleaf tool refuses with exit 3 and nothing written, with the Pixoo tool's code. `module-db-not-private` stays exit 4 in both: any existing database is `destination-not-empty`, so only a file that changes under the lease reaches it. The state-directory checks still differ, since the Nanoleaf tool also checks its secrets and section folders.

## Risks / Trade-offs

- `openModuleDatabaseFile` now also treats `ENOSPC` and a wrapped full disk as a full disk when WAL mode cannot be set; SQLite reports a full disk there as `SQLITE_FULL`, so the outcome is the same.
