// Copied verbatim from apps/server/src/security.ts at the provenance commit (modules/pixoo/README.md).
// The rest of that file is the HTTP server's request guard, which the runtime replaces.
export class ApiError extends Error {
 constructor(readonly code:string,readonly status=400,readonly details?:Record<string,unknown>){super(code);this.name='ApiError';}
}
