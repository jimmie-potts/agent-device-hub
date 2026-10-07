// A render worker that always fails, so a test sees how the Pixoo module treats a failed render.
export {};
throw new Error('the render failed');
