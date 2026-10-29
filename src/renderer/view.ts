// Which parts of the page show, and when. A plain script (no imports, no DOM use of its
// own) that loads before renderer.ts, so test/view.test.mjs can run it under Node.
//   compose:  the hero question and the "build me" box (with Advanced and its chip).
//   building: from the moment the folder is picked until the build ends, the box is away;
//             one quiet "Building: ..." line says what is being built.
//   result:   the result card; "Build something else" brings the box back, empty.
// The status line is not part of this: it follows the run's phase (renderer.ts setPhase).

type View = 'compose' | 'building' | 'result';

type ViewEvent =
  /** A flow status word (src/main/flow.ts setStatus). */
  | { type: 'status'; status: string }
  | { type: 'build-started' }
  | { type: 'build-ended' }
  /** confirm() came back with an error and no build ran (the files could not be copied, say). */
  | { type: 'confirm-error' }
  /** "Build something else" on the result card. */
  | { type: 'result-closed' };

/** The element ids each view shows; every id listed in any view is hidden in the others. */
const VIEW_PARTS: Record<View, string[]> = {
  compose: ['hero', 'request-form'],
  building: ['building'],
  result: ['result'],
};

function nextView(current: View, event: ViewEvent): View {
  switch (event.type) {
    case 'status':
      // "Copying your files" comes right after the folder is picked, before the build starts.
      if (current === 'compose' && (event.status === 'Copying your files' || event.status === 'Building...')) return 'building';
      return current;
    case 'build-started':
      return 'building';
    case 'build-ended':
      return 'result';
    case 'confirm-error':
      return current === 'building' ? 'compose' : current;
    case 'result-closed':
      return current === 'result' ? 'compose' : current;
  }
}

/** Shows the view's parts and hides the rest. */
function applyView(view: View, element: (id: string) => { hidden: boolean | string }): void {
  const shown = new Set(VIEW_PARTS[view]);
  for (const id of new Set(Object.values(VIEW_PARTS).flat())) element(id).hidden = !shown.has(id);
}

/** "Building: a pomodoro timer" from the request ("Build me a pomodoro timer", or just what
 *  was typed), on one line. The page cuts it off with an ellipsis if it is still too long. */
function buildingLine(request: string): string {
  const what = request.replace(/\s+/g, ' ').trim().replace(/^build me\b[\s:,]*/i, '');
  const short = what.length > 200 ? `${what.slice(0, 199)}…` : what;
  return short ? `Building: ${short}` : 'Building...';
}
