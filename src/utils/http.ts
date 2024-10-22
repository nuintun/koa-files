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

type Ranges = Range[] | -1 | -2;

const TOKEN_SPLIT_REGEX = /\s*,\s*/;
const ETAG_RE = /(?:W\/)?"[ !#-\x7E\x80-\xFF]+"/;

/**
 * @function parseTokens
 * @description Parse HTTP tokens.
 * @param value The tokens value string.
 */
function parseTokens(value: string): string[] {
  return value.trim().split(TOKEN_SPLIT_REGEX);
}

// https://github.com/oakserver/commons/blob/main/range.ts#L583
// https://github.com/sstur/xcurl/blob/main/src/support/parseHeaderValue.ts
// https://github.com/hattipjs/deno-release/blob/fe809a4/src/headers/parser.ts
// https://github.com/hattipjs/hattip/blob/main/packages/base/headers/src/parser.ts
function parseTokens1(headerValue: string): string[] {
  const matches: string[] = [];
  const pattern = /"(.*?)"|([^",\s]+)/g;

  let match: RegExpExecArray | null;

  // Loop to retrieve matching items.
  while ((match = pattern.exec(headerValue)) != null) {
    // The value match[1] is a match within quotation marks,
    // The value match[2] is the non quotation mark part.
    matches.push(match[1] || match[2]);
  }

  return matches;
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
 * @function isETagMatching
 * @description Check if etag is matching.
 * @param match The match value.
 * @param etag The etag value.
 */
function isETagMatching(match: string, etag: string): boolean {
  return match === etag || match === `W/${etag}` || `W/${match}` === etag;
}

/**
 * @function isPreconditionFailure
 * @description Check if request precondition failure.
 * @param context The koa context.
 */
export function isPreconditionFailure({ request, response }: Context): boolean {
  // If-Match.
  const match = request.get('If-Match');

  // Check if request match.
  if (match) {
    // Etag.
    const etag = response.get('ETag');

    return !etag || (match !== '*' && !parseTokens(match).some(token => isETagMatching(token, etag)));
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

  // If-Range as etag.
  if (Number.isNaN(ifRangeDate)) {
    const etag = response.get('ETag');

    return !!(etag && isETagMatching(ifRange, etag));
  }

  if (!Number.isNaN(ifRangeDate)) {
    const lastModifiedDate = Date.parse(response.get('Last-Modified'));

    return !Number.isNaN(lastModifiedDate) && lastModifiedDate === ifRangeDate;
  }

  // Range not fresh.
  return false;
}

/**
 * @function parseRanges
 * @description Parse ranges.
 * @param context The koa context.
 * @param stats The file stats.
 */
export function parseRanges(context: Context, stats: Stats): Ranges {
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
