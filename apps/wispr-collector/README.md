# Private Wispr collector

This Windows Node 24 CLI reads one explicitly configured local source and retains private analytics. The aggregate JSON boundary is the only input intended for the Hub in WSL. Neither SQLite database is a WSL input. Development uses synthetic data only; source delivery does not install or schedule collection.

The source profile uses the `History` table with `id`, `timestamp`, `status` and `numWords`; optional numeric fields are `duration`, `speechDuration`, `numWordsCorrected`, `numDictionaryReplacements` and `appName`. Required names/types must qualify. Unknown optional fields are ignored. Installed schema and duration/counter semantics need separate confirmation; unsupported fields never become known zeros. Numeric mode does not select transcript, context, audio or arbitrary source columns.

## Development checks

From the repository root with Node 24:

```sh
npm ci
npm run build
npm run typecheck
npm run test:wispr
npm run test:wispr:package
```

`test:wispr:built` runs synthetic pure, reader, store, contract and CLI checks against fresh build output. `test:wispr:package:built` verifies the extracted offline artifact and isolated contract consumer. These are development checks; they do not use an installed Wispr database.

`npm run test:wispr:native:built` must also run with native Windows Node 24 and synthetic files on a local Windows drive. It must fail, rather than skip and report success, on other platforms. Linux tests do not qualify Windows WAL, locks, ACLs or atomic replacement. See [development checks](../../docs/development.md#wispr-collector-checks) for the required evidence.

The runbook and executable interface are being implemented in this change. Do not install or point the development candidate at personal data.
