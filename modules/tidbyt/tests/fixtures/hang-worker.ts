// A render worker that never answers (Hub #930): it keeps its thread alive until the module's call ends it, as a render
// stuck on a slow machine would.
setInterval(() => {}, 60_000);
