// Copies the renderer's static files (HTML, CSS) next to the compiled renderer script.
import { cpSync } from 'node:fs';

cpSync('src/renderer', 'dist/renderer', {
  recursive: true,
  filter: (src) => !src.endsWith('.ts'),
});
