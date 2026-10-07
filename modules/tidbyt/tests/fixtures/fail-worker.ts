// A render worker that fails (Hub #930): it throws before it answers, as a fault in the drawing code would.
throw new RangeError('the render failed');
