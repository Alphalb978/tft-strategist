export interface ParsedRiotId {
  gameName: string;
  tagLine: string;
  display: string;
}

export class RiotIdInputError extends Error {
  readonly code = 'malformed-riot-id';
  constructor(message = 'Use a Riot ID in the form gameName#tagLine.') {
    super(message);
    this.name = 'RiotIdInputError';
  }
}

export function parseRiotId(value: string): ParsedRiotId {
  const normalized = value.normalize('NFC').trim();
  const separator = normalized.lastIndexOf('#');
  if (separator <= 0 || separator === normalized.length - 1) throw new RiotIdInputError();
  const gameName = normalized.slice(0, separator).trim();
  const tagLine = normalized.slice(separator + 1).trim();
  if (!gameName || !tagLine || gameName.includes('\n') || tagLine.includes('\n'))
    throw new RiotIdInputError();
  return { gameName, tagLine, display: `${gameName}#${tagLine}` };
}

export function parseOpponentList(value: string): {
  valid: ParsedRiotId[];
  invalid: string[];
  duplicates: string[];
  overflow: number;
} {
  const entries = value
    .split(/[\n,;]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const valid: ParsedRiotId[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    try {
      const parsed = parseRiotId(entry);
      const key = `${parsed.gameName}#${parsed.tagLine}`.toLocaleLowerCase('en-US');
      if (seen.has(key)) duplicates.push(parsed.display);
      else {
        seen.add(key);
        valid.push(parsed);
      }
    } catch {
      invalid.push(entry);
    }
  }
  return { valid: valid.slice(0, 7), invalid, duplicates, overflow: Math.max(0, valid.length - 7) };
}
