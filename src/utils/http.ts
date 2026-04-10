/**
 * @module http
 */

import { Context } from 'koa';
import { Stats } from 'node:fs';
import { generate } from './hash';
import { Buffer } from 'node:buffer';
import parseRange from 'range-parser';

export interface Range {
  offset: number;
  length: number;
  prefix?: Buffer;
  suffix?: Buffer;
}

const SPLIT_ETAG_RE = /\s*,\s*/;
const SINGLE_ETAG_RE = /^(?:W\/)?"[ !#-\x7E\x80-\xFF]+"$/;

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
 * @param context The koa context.
 */
export function isConditionalGET({ request }: Context): boolean {
  return !!(
    request.get('If-Match') ||
    request.get('If-None-Match') ||
    request.get('If-Modified-Since') ||
    request.get('If-Unmodified-Since')
  );
}

/**
 * @function isETagMatch
 * @see https://httpwg.org/specs/rfc9110.html
 * @param match The match value.
 * @param etag The etag value.
 * @param isIfMatch The flag of if-match.
 */
function isETagMatch(match: string, etag: string, isIfMatch?: boolean): boolean {
  // Trim etag.
  etag = etag.trim();

  // Weak tags cannot be matched and return false.
  if (!etag || etag.startsWith('W/')) {
    return false;
  }

  // Trim match.
  match = match.trim();

  // Check If-Match.
  if (isIfMatch) {
    if (match === '*') {
      return true;
    }

    // If-Match maybe a list of etag.
    return match.split(SPLIT_ETAG_RE).includes(etag);
  }

  // Check If-Range.
  return match === etag;
}

/**
 * @function isPreconditionFailed
 * @description Check if request precondition failed.
 * @param context The koa context.
 */
export function isPreconditionFailed({ request, response }: Context): boolean {
  // If-Match.
  const ifMatch = request.get('If-Match');

  // Check If-Match.
  if (ifMatch) {
    return !isETagMatch(ifMatch, response.get('ETag'), true);
  }

  // If-Unmodified-Since.
  const unmodifiedSince = Date.parse(request.get('If-Unmodified-Since'));

  // Check If-Unmodified-Since.
  if (!Number.isNaN(unmodifiedSince)) {
    const lastModified = Date.parse(response.get('Last-Modified'));

    return Number.isNaN(lastModified) || lastModified > unmodifiedSince;
  }

  // Check precondition passed.
  return false;
}

/**
 * @function isRangeFresh
 * @description Check if request range fresh.
 * @param context Koa context.
 */
function isRangeFresh({ request, response }: Context): boolean {
  const ifRange = request.get('If-Range');

  // No If-Range.
  if (!ifRange) {
    return true;
  }

  // If-Range as modified date failed.
  if (SINGLE_ETAG_RE.test(ifRange)) {
    return isETagMatch(ifRange, response.get('ETag'));
  }

  // Check if Last-Modified is valid and equal to If-Range date
  return Date.parse(response.get('Last-Modified')) <= Date.parse(ifRange);
}

/**
 * @function parseRanges
 * @description Parse ranges.
 * @param context The koa context.
 * @param stats The file stats.
 */
export function parseRanges(context: Context, stats: Stats): -1 | -2 | Range[] {
  const { size } = stats;
  const { request, response } = context;

  // Range support.
  if (/^bytes$/i.test(response.get('Accept-Ranges'))) {
    const range = request.get('Range');

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
        response.status = 206;

        const { length } = parsed;

        // Multiple ranges.
        if (length > 1) {
          // Content-Length.
          let contentLength = 0;

          // Ranges.
          const ranges: Range[] = [];
          // Parsed entries.
          const entries = parsed.entries();
          // Range boundary.
          const boundary = `${generate(32)}`;
          // Multipart Content-Type.
          const contentType = `Content-Type: ${response.type}`;
          // Range suffix.
          const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);

          // Override Content-Type.
          // https://httpwg.org/specs/rfc9110.html#multipart.byteranges
          response.type = `multipart/byteranges; boundary=${boundary}`;

          // Map ranges.
          for (const [index, { start, end }] of entries) {
            const length = end - start + 1;
            const head = index > 0 ? '\r\n' : '';
            const contentRange = `Content-Range: bytes ${start}-${end}/${size}`;
            const prefix = Buffer.from(`${head}--${boundary}\r\n${contentType}\r\n${contentRange}\r\n\r\n`);

            // Compute Content-Length
            contentLength += prefix.length + length;

            // Cache range.
            ranges.push({ offset: start, length, prefix });
          }

          // Compute Content-Length.
          contentLength += suffix.length;

          // Set Content-Length.
          response.length = contentLength;

          // The last add suffix boundary.
          ranges[length - 1].suffix = suffix;

          // Return ranges.
          return ranges;
        } else {
          const [{ start, end }] = parsed;
          const length = end - start + 1;

          // Set Content-Length.
          response.length = length;

          // Set Content-Range.
          response.set('Content-Range', `bytes ${start}-${end}/${size}`);

          // Return ranges.
          return [{ offset: start, length }];
        }
      }
    }
  }

  // Set Content-Length.
  response.length = size;

  // Return ranges.
  return [{ offset: 0, length: size }];
}
