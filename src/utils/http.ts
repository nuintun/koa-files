/**
 * @module http
 */

import { Stats } from 'fs';
import { Context } from 'koa';
import { Buffer } from 'buffer';
import { generate } from './hash';
import parseRange from 'range-parser';

export interface Range {
  offset: number;
  length: number;
  prefix?: Buffer;
  suffix?: Buffer;
}

const WEAK_ETAG_RE = /^W\/$/;
const SPLIT_ETAG_RE = /\s*,\s*/;
const STAR_ETAG_RE = /^\s*\*\s*$/;

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
 * @function ifMatch
 * @see https://httpwg.org/specs/rfc9110.html#rfc.section.13.1.1
 * @param match The if-match header.
 * @param etag The etag header.
 */
function ifMatch(match: string, etag: string): boolean {
  // Weak tags cannot be matched and return false.
  if (!etag || WEAK_ETAG_RE.test(match)) {
    return false;
  }

  if (STAR_ETAG_RE.test(match)) {
    return true;
  }

  const tags = match.split(SPLIT_ETAG_RE);

  return tags.includes(etag.trim());
}

/**
 * @function ifETagRange
 * @see https://httpwg.org/specs/rfc9110.html#field.if-range
 * @param range The if-range header.
 * @param etag The etag header.
 */
function ifETagRange(range: string, etag: string): boolean {
  // Weak tags cannot be matched and return false.
  if (!etag || WEAK_ETAG_RE.test(range)) {
    return false;
  }

  return range.trim() === etag.trim();
}

/**
 * @function isPreconditionFailed
 * @description Check if request precondition failed.
 * @param context The koa context.
 */
export function isPreconditionFailed({ request, response }: Context): boolean {
  // If-Match.
  const match = request.get('If-Match');

  // Check if request match.
  if (match) {
    return !ifMatch(match, response.get('ETag'));
  }

  // If-Unmodified-Since.
  const unmodifiedSinceDate = Date.parse(request.get('If-Unmodified-Since'));

  // Check if request unmodified.
  if (!Number.isNaN(unmodifiedSinceDate)) {
    // Last-Modified.
    const lastModifiedDate = Date.parse(response.get('Last-Modified'));

    return Number.isNaN(lastModifiedDate) || lastModifiedDate > unmodifiedSinceDate;
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

  // If-Range as modified date.
  const ifRangeDate = Date.parse(ifRange);

  // If-Range as modified date failed.
  if (Number.isNaN(ifRangeDate)) {
    return ifETagRange(ifRange, response.get('ETag'));
  }

  const lastModifiedDate = Date.parse(response.get('Last-Modified'));

  return !Number.isNaN(lastModifiedDate) && lastModifiedDate === ifRangeDate;
}

/**
 * @function parseRanges
 * @description Parse ranges.
 * @param context The koa context.
 * @param stats The file stats.
 */
export function parseRanges(context: Context, stats: Stats): Range[] | -1 | -2 {
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
          response.type = `multipart/byteranges; boundary="${boundary}"`;

          // Map ranges.
          for (const [index, { start, end }] of entries) {
            const length = end - start + 1;
            const head = index > 0 ? '\r\n' : '';
            const contentRange = `Content-Range: bytes ${start}-${end}/${size}`;
            const prefix = Buffer.from(`${head}--${boundary}\r\n${contentType}\r\n${contentRange}\r\n\r\n`);

            // Compute Content-Length
            contentLength += length + prefix.length;

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
