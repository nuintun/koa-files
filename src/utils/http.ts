/**
 * @module http
 */

import { Context } from 'koa';

/**
 * @function decodeURI
 * @description Decode URI component.
 * @param URI The URI to decode.
 */
export function decodeURI(URI: string): string | -1 {
  try {
    return decodeURIComponent(URI);
  } catch {
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

  // Gather tokens.
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
function isETag(value: string): boolean {
  return /^(?:W\/)?"[\s\S]+"$/.test(value);
}

/**
 * @function isETagFresh
 * @description Check if etag is fresh.
 * @param match The match value.
 * @param etag The etag value.
 */
function isETagFresh(match: string, etag: string): boolean {
  return parseTokens(match).some(match => {
    return match === etag || match === 'W/' + etag || 'W/' + match === etag;
  });
}

/**
 * @function isConditionalGET
 * @description Check if request is conditional GET.
 * @param context Koa context.
 */
export function isConditionalGET(context: Context): boolean {
  const { request } = context;

  return !!(
    request.get('If-Match') ||
    request.get('If-None-Match') ||
    request.get('If-Modified-Since') ||
    request.get('if-Unmodified-Since')
  );
}

/**
 * @function isRangeFresh
 * @description Check if request range fresh.
 * @param context Koa context.
 */
export function isRangeFresh(context: Context): boolean {
  const { request, response } = context;
  const ifRange = request.get('If-Range');

  // No If-Range.
  if (!ifRange) {
    return true;
  }

  // If-Range as etag.
  if (isETag(ifRange)) {
    const etag = response.get('ETag');

    return !!(etag && isETagFresh(ifRange, etag));
  }

  // If-Range as modified date.
  const lastModified = response.get('Last-Modified');

  return Date.parse(lastModified) <= Date.parse(ifRange);
}

/**
 * @function isPreconditionFailure
 * @description Check if request precondition failure.
 * @param context Koa context.
 */
export function isPreconditionFailure(context: Context): boolean {
  const { request, response } = context;

  // If-Match.
  const match = request.get('If-Match');

  if (match) {
    const etag = response.get('ETag');

    return !etag || (match !== '*' && !isETagFresh(match, etag));
  }

  // If-Unmodified-Since.
  const unmodifiedSince = Date.parse(request.get('If-Unmodified-Since'));

  if (!Number.isNaN(unmodifiedSince)) {
    const lastModified = Date.parse(response.get('Last-Modified'));

    return Number.isNaN(lastModified) || lastModified > unmodifiedSince;
  }

  return false;
}
