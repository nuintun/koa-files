/**
 * @module http
 */

import { Stats } from 'fs';
import { Context } from 'koa';
import { generate } from './hash';
import parseRange from 'range-parser';

export interface Range {
  start: number;
  end?: number;
  prefix?: string;
  suffix?: string;
}

type Ranges = Range[] | -1 | -2;

/**
 * @function isETag
 * @description Check if etag is valid.
 * @param value The value to check.
 */
function isETag(value: string): boolean {
  return /^(?:W\/)?"[\s\S]+"$/.test(value);
}

/**
 * @function parseTokens
 * @description Parse HTTP tokens.
 * @param value The tokens value string.
 */
function parseTokens(value: string): string[] {
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
 * @function isRangeFresh
 * @description Check if request range fresh.
 * @param context Koa context.
 */
function isRangeFresh(context: Context): boolean {
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
    request.get('If-Unmodified-Since')
  );
}

/**
 * @function isPreconditionFailure
 * @description Check if request precondition failure.
 * @param context Koa context.
 */
export function isPreconditionFailure({ request, response }: Context): boolean {
  // If-Match.
  const match = request.get('If-Match');

  // Check if request match.
  if (match) {
    // Etag.
    const etag = response.get('ETag');

    return !etag || match === '*' || !isETagFresh(match, etag);
  }

  // If-Unmodified-Since.
  const unmodifiedSince = Date.parse(request.get('If-Unmodified-Since'));

  // Check if request unmodified.
  if (!Number.isNaN(unmodifiedSince)) {
    // Last-Modified.
    const lastModified = Date.parse(response.get('Last-Modified'));

    return Number.isNaN(lastModified) || lastModified > unmodifiedSince;
  }

  // Check precondition passed.
  return false;
}

/**
 * @function parseRanges
 * @description Parse ranges.
 * @param context Koa context.
 * @param stats File stats.
 */
export function parseRanges(context: Context, stats: Stats): Ranges {
  const { size } = stats;

  // Range support.
  if (/^bytes$/i.test(context.response.get('Accept-Ranges'))) {
    const range = context.request.get('Range');

    // Range fresh.
    if (range && isRangeFresh(context)) {
      // Parse range -1 -2 or [].
      const parsed = parseRange(size, range, { combine: true });

      // -1 signals an unsatisfiable range.
      // -2 signals a malformed header string.
      if (parsed === -1 || parsed === -2) {
        return parsed;
      }

      // Ranges ok, support multiple ranges.
      if (parsed.type === 'bytes') {
        // Set 206 status.
        context.status = 206;

        const { length } = parsed;

        // Multiple ranges.
        if (length > 1) {
          // Content-Length.
          let contentLength = 0;

          // Ranges.
          const ranges: Range[] = [];
          // Range boundary.
          const boundary = `<${generate()}>`;
          // Range suffix.
          const suffix = `\r\n--${boundary}--\r\n`;
          // Multipart Content-Type.
          const contentType = `Content-Type: ${context.type}`;

          // Override Content-Type.
          context.type = `multipart/byteranges; boundary=${boundary}`;

          // Map ranges.
          for (let index = 0; index < length; index++) {
            const { start, end } = parsed[index];
            // The first prefix boundary no \r\n.
            const head = index > 0 ? '\r\n' : '';
            const contentRange = `Content-Range: bytes ${start}-${end}/${size}`;
            const prefix = `${head}--${boundary}\r\n${contentType}\r\n${contentRange}\r\n\r\n`;

            // Compute Content-Length
            contentLength += end - start + 1 + Buffer.byteLength(prefix);

            // Cache range.
            ranges.push({ start, end, prefix });
          }

          // The last add suffix boundary.
          ranges[length - 1].suffix = suffix;
          // Compute Content-Length.
          contentLength += Buffer.byteLength(suffix);
          // Set Content-Length.
          context.length = contentLength;

          // Return ranges.
          return ranges;
        } else {
          const [{ start, end }] = parsed;

          // Set Content-Length.
          context.length = end - start + 1;

          // Set Content-Range.
          context.set('Content-Range', `bytes ${start}-${end}/${size}`);

          // Return ranges.
          return parsed;
        }
      }
    }
  }

  // Set Content-Length.
  context.length = size;

  // Return ranges.
  return [{ start: 0, end: Math.max(size - 1) }];
}
