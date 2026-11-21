// Home's one status line for lighting layout saves (#1933, fuse.tsx). Every Home light, plug and group card leaves its
// layout results and its own refusals to this line, so it must say what the latest save is doing in every state the
// shared `lighting` attempt can be in, and a card's note must never hide a newer save result, or the reverse.

/** The shared `lighting` attempt as `useAttempt` reports it. */
export type LineSave = {requestId: string | undefined; text: string; locked: boolean};
export type HomeLineInput = {
  save: LineSave;
  /** Monotonic stamp of the save's last change (request, text or lock). */
  saveStamp: number;
  /** The grouping this Home started, by its request, with its progress text ("Grouping X with Y."). */
  grouping?: {requestId: string; text: string};
  /** A card's own note (a local refusal), stamped from the same counter when it was said. */
  note?: {text: string; stamp: number};
};
/** What the line says, and whether it offers Refresh records (a result that needs current records to act on). */
export type HomeLine = {text: string; recover: boolean};
const NONE: HomeLine = {text: '', recover: false};

/**
 * The line: the newer of a card's note and the latest save's state, except that a save left locked with an unknown
 * outcome (uncertain or conflicting) always shows, whatever note is newer. A save says nothing once it succeeded. In flight,
 * a grouping shows its progress text and another save its own ("Layout: Requested..."). A grouping that was refused,
 * not sent, expired or failed says "Not grouped"; one whose outcome is unknown (uncertain or conflicting, which stay
 * locked) says so after its progress text, since the group may have been saved. Any other save that needs attention says
 * "Layout:" and its result. Every settled or locked result that needs attention offers Refresh records.
 */
export function homeLine({save, saveStamp, grouping, note}: HomeLineInput): HomeLine {
  const waiting = save.locked && /^(Requested|Accepted)\./.test(save.text);
  // An uncertain or conflicting save stays locked with the same text, so its stamp never moves again; a later note must
  // not hide it and its Refresh records.
  const stuck = save.requestId !== undefined && save.locked && !waiting;
  if (note !== undefined && note.stamp > saveStamp && !stuck) return {text: note.text, recover: false};
  if (save.requestId === undefined || (!save.locked && /^Completed: succeeded/.test(save.text))) return NONE;
  if (grouping !== undefined && grouping.requestId === save.requestId) {
    if (waiting) return {text: grouping.text, recover: false};
    return {text: save.locked ? `${grouping.text.replace(/\.$/, '')}: ${save.text}` : `Not grouped: ${save.text}`, recover: true};
  }
  return {text: `Layout: ${save.text}`, recover: !waiting};
}
