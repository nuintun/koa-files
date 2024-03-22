/**
 * @module http
 */

/**
 * @function decodeURI
 * @description Decode URI component.
 * @param URI The URI to decode.
 */
export function decodeURI(URI: string): string | -1 {
  try {
    return decodeURIComponent(URI);
  } catch (error) {
    return -1;
  }
}

/**
 * @function parseTokens
 * @description Parse HTTP tokens.
 * @param value The tokens value string.
 */
export function parseTokens(value: string): string[] {
  let end = 0;
  let start = 0;
  let tokens: string[] = [];

  // Gather tokens
  for (let i = 0, length = value.length; i < length; i++) {
    switch (value.charCodeAt(i)) {
      case 0x20:
        // ' '.
        if (start === end) {
          start = end = i + 1;
        }
        break;
      case 0x2c:
        // ','.
        tokens.push(value.substring(start, end));
        start = end = i + 1;
        break;
      default:
        end = i + 1;
        break;
    }
  }

  // Final token.
  tokens.push(value.substring(start, end));

  return tokens;
}

/**
 * @function isETag
 * @description Check if etag is valid.
 * @param value The value to check.
 */
export function isETag(value: string): boolean {
  return /^(?:W\/)?"[\s\S]+"$/.test(value);
}

/**
 * @function isETagFresh
 * @description Check if etag is fresh.
 * @param match The match value.
 * @param etag The etag value.
 */
export function isETagFresh(match: string, etag: string): boolean {
  return parseTokens(match).some(match => {
    return match === etag || match === 'W/' + etag || 'W/' + match === etag;
  });
}
