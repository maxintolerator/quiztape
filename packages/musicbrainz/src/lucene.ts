/** Escape a literal term for the Lucene query syntax MusicBrainz search uses. */
export function luceneEscape(term: string): string {
  return term.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
}

/** Build `field:"value"` with the value quoted and escaped. */
export function fieldQuery(field: string, value: string): string {
  return `${field}:"${value.replace(/(["\\])/g, '\\$1')}"`;
}
