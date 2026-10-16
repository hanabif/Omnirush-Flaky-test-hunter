const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
const WINDOWS_PATH = /\b[A-Za-z]:\\[^\s:'"]+/g;
const UNIX_TEMP_PATH = /\/(?:tmp|var\/folders|private\/var\/folders)\/[^\s:'"]+/g;
const RUN_ID = /\b(?:run|attempt|investigation)[-_][a-z0-9-]+\b/gi;

export function normalizeFailureSignature(message: string): string {
  return message
    .replace(UUID, '<uuid>')
    .replace(ISO_DATE, '<timestamp>')
    .replace(WINDOWS_PATH, '<path>')
    .replace(UNIX_TEMP_PATH, '<path>')
    .replace(RUN_ID, '<run>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 500);
}
