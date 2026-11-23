type AttachmentPlaybackIntent =
  | {kind: 'offer-display'}
  | {kind: 'choose-display'}
  | {kind: 'display'; destination: string}
  | {kind: 'message'};

const directRequest = /^(?:please[ \t]+)?(?:play|show)[ \t]+(?:this|it)(?:[ \t]+(?:image|gif|attachment))?(?:[ \t]+on[ \t]+((?:id:)?[\p{L}\p{N}][\p{L}\p{N} _-]*))?[.!]?$/iu;
const multipleOrConditional = /(?:^|[ \t])(?:and|or|if|when|unless|then|after|before)(?:[ \t]|$)/iu;

export function attachmentPlaybackIntent(text: string): AttachmentPlaybackIntent {
  const trimmed = text.trim();
  if (trimmed === '') return {kind: 'offer-display'};
  const match = directRequest.exec(trimmed);
  if (match === null) return {kind: 'message'};
  const destination = match[1]?.trim();
  if (destination === undefined) return {kind: 'choose-display'};
  if (destination.length > 128 || multipleOrConditional.test(destination)) return {kind: 'message'};
  return {kind: 'display', destination};
}
