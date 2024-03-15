/**
 * @module Files
 * @license MIT
 * @author nuintun
 */

import etag from 'etag';
import destroy from 'destroy';
import { Context } from 'koa';
import fs, { Stats } from 'fs';
import { PassThrough } from 'stream';
import parseRange from 'range-parser';
import { extname, join, resolve } from 'path';
import { boundaryGenerator, decodeURI, fstat, hasTrailingSlash, isETag, isETagFresh, isOutRoot, unixify } from './utils';

export interface Options {
  etag?: boolean;
  cacheControl?: string;
  acceptRanges?: boolean;
  lastModified?: boolean;
  ignore?: (path: string) => boolean;
}

interface Range {
  start: number;
  end?: number;
  prefix?: string;
  suffix?: string;
}

type Ranges = Range[] | -1 | -2;

/**
 * @class Files
 */
export default class Files {
  private root: string;
  private options: Options;

  /**
   * @constructor
   * @param {string} root
   * @param {Options} options
   */
  constructor(root: string, options: Options = {}) {
    this.options = options;
    this.root = unixify(resolve(root));
  }

  /**
   * @method isConditionalGET
   * @param {Context} context
   * @returns {boolean}
   */
  private isConditionalGET(context: Context): boolean {
    const { request } = context;

    return !!(
      request.get('If-Match') ||
      request.get('If-None-Match') ||
      request.get('If-Modified-Since') ||
      request.get('if-Unmodified-Since')
    );
  }

  /**
   * @method isPreconditionFailure
   * @param {Context} context
   * @returns {boolean}
   */
  private isPreconditionFailure(context: Context): boolean {
    const { request, response } = context;

    // If-Match
    const match = request.get('If-Match');

    if (match) {
      const etag = response.get('ETag');

      return !etag || (match !== '*' && !isETagFresh(match, etag));
    }

    // If-Unmodified-Since
    const unmodifiedSince = Date.parse(request.get('If-Unmodified-Since'));

    if (!isNaN(unmodifiedSince)) {
      const lastModified = Date.parse(response.get('Last-Modified'));

      return isNaN(lastModified) || lastModified > unmodifiedSince;
    }

    return false;
  }

  /**
   * @method isRangeFresh
   * @param {Context} context
   * @returns {boolean}
   */
  private isRangeFresh(context: Context): boolean {
    const { request, response } = context;
    const ifRange = request.get('If-Range');

    // No If-Range
    if (!ifRange) {
      return true;
    }

    // If-Range as etag
    if (isETag(ifRange)) {
      const etag = response.get('ETag');

      return !!(etag && isETagFresh(ifRange, etag));
    }

    // If-Range as modified date
    const lastModified = response.get('Last-Modified');

    return Date.parse(lastModified) <= Date.parse(ifRange);
  }

  /**
   * @method isIgnore
   * @param {string} path
   * @returns {boolean}
   */
  private isIgnore(path: string): boolean {
    const { ignore } = this.options;

    return (typeof ignore === 'function' ? ignore(path) : false) === true;
  }

  /**
   * @method parseRange
   * @param {Context} context
   * @param {Stats} stats
   * @returns {Ranges}
   */
  private parseRange(context: Context, stats: Stats): Ranges {
    const { size } = stats;
    const { request } = context;

    // Content-Length
    let contentLength = size;

    // Ranges
    const ranges: Range[] = [];

    // Range support
    if (this.options.acceptRanges !== false) {
      const range = request.get('Range');

      // Range fresh
      if (range && this.isRangeFresh(context)) {
        // Parse range -1 -2 or []
        const parsed = parseRange(size, range, { combine: true });

        // -1 signals an unsatisfiable range
        // -2 signals a malformed header string
        if (parsed === -1 || parsed === -2) {
          return parsed;
        }

        // Ranges ok, support multiple ranges
        if (parsed.type === 'bytes') {
          // Set 206 status
          context.status = 206;

          // Multiple ranges
          if (parsed.length > 1) {
            // Reset content-length
            contentLength = 0;

            // Range boundary
            const boundary = `<${boundaryGenerator()}>`;
            const suffix = `\r\n--${boundary}--\r\n`;
            const contentType = `Content-Type: ${context.type}`;

            context.type = `multipart/byteranges; boundary=${boundary}`;

            // Map ranges
            parsed.forEach(({ start, end }, index) => {
              // The first prefix boundary no \r\n
              const prefixHead = index > 0 ? '\r\n' : '';
              const contentRange = `Content-Range: bytes ${start}-${end}/${size}`;
              const prefix = `${prefixHead}--${boundary}\r\n${contentType}\r\n${contentRange}\r\n\r\n`;

              // Compute content-length
              contentLength += end - start + 1 + Buffer.byteLength(prefix);

              // Cache range
              ranges.push({ start, end, prefix });
            });

            // The last add suffix boundary
            ranges[ranges.length - 1].suffix = suffix;
            // Compute content-length
            contentLength += Buffer.byteLength(suffix);
          } else {
            const { start, end } = parsed[0];

            context.set('Content-Range', `bytes ${start}-${end}/${size}`);

            // Compute content-length
            contentLength = end - start + 1;

            // Cache range
            ranges.push({ start, end });
          }
        }
      }
    }

    // Set Content-Length
    context.length = contentLength;

    return ranges.length ? ranges : [{ start: 0 }];
  }

  /**
   * @method setupHeaders
   * @param {Context} context
   * @param {string} path
   * @param {Stats} stats
   */
  private setupHeaders(context: Context, path: string, stats: Stats): void {
    const { options } = this;
    const { toString } = Object.prototype;
    const { acceptRanges, cacheControl, lastModified } = options;

    // Set status
    context.status = 200;

    // Set Content-Type
    context.type = extname(path);

    // ETag
    if (options.etag !== false) {
      // Set ETag
      context.set('ETag', etag(stats));
    }

    // Accept-Ranges
    if (acceptRanges !== false) {
      // Set Accept-Ranges
      context.set('Accept-Ranges', 'bytes');
    }

    // Last-Modified
    if (lastModified !== false) {
      // Set mtime utc string
      context.set('Last-Modified', stats.mtime.toUTCString());
    }

    // Cache-Control
    if (cacheControl && toString.call(cacheControl) === '[object String]') {
      // Set Cache-Control
      context.set('Cache-Control', cacheControl);
    }
  }

  /**
   * @method read
   * @param {string} path
   * @param {Range} range
   * @param {PassThrough} buffer
   * @param {boolean} end
   * @returns {Promise<true>}
   */
  private read(path: string, range: Range, buffer: PassThrough, end: boolean): Promise<true> {
    return new Promise((resolve, reject): void => {
      // Create file stream
      const file = fs.createReadStream(path, range);

      // File read stream open
      if (range.prefix) {
        file.once('open', () => {
          // Write prefix boundary
          buffer.write(range.prefix);
        });
      }

      // File read stream error
      file.once('error', error => {
        // Unpipe
        file.unpipe(buffer);
        // Destroy file stream
        destroy(file);
        // Reject
        reject(error);
      });

      // File read stream end
      if (range.suffix) {
        file.once('end', () => {
          // Push suffix boundary
          buffer.write(range.suffix);
        });
      }

      // File read stream close
      file.once('close', () => {
        // Unpipe
        file.unpipe(buffer);
        // Destroy file stream
        destroy(file);
        // Resolve
        resolve(true);
      });

      // Write data to buffer
      file.pipe(buffer, { end });
    });
  }

  /**
   * @method response
   * @param {Context} context
   * @returns {Promise<boolean>}
   */
  public async response(context: Context): Promise<boolean> {
    const { root } = this;

    // Only support GET and HEAD (405)
    if (context.method !== 'GET' && context.method !== 'HEAD') {
      return false;
    }

    // Get path of file
    const pathname = decodeURI(context.path);
    const path = pathname === -1 ? pathname : unixify(join(root, pathname));

    // Path -1 or null byte(s)
    if (path === -1 || path.includes('\0')) {
      return context.throw(400);
    }

    // Malicious path (403)
    if (isOutRoot(path, root)) {
      return false;
    }

    // Is ignore path or file (403)
    if (this.isIgnore(path)) {
      return false;
    }

    // File stats
    let stats: Stats;

    // Get file stats
    try {
      stats = await fstat(path);
    } catch (error) {
      // 404 | 500
      return false;
    }

    // File not exist (404 | 500)
    if (!stats) {
      return false;
    }

    // Is directory (403)
    if (stats.isDirectory()) {
      return false;
    }

    // Not a directory but has trailing slash (404)
    if (hasTrailingSlash(path)) {
      return false;
    }

    // Setup headers
    this.setupHeaders(context, path, stats);

    // Conditional get support
    if (this.isConditionalGET(context)) {
      // Request precondition failure
      if (this.isPreconditionFailure(context)) {
        return context.throw(412);
      }

      // Request fresh (304)
      if (context.fresh) {
        // Set status
        context.status = 304;
        // Set body null
        context.body = null;

        return true;
      }
    }

    // Head request
    if (context.method === 'HEAD') {
      // Set content-length
      context.length = stats.size;
      // Set body null
      context.body = null;

      return true;
    }

    // Parsed ranges
    const ranges = this.parseRange(context, stats);

    // 416
    if (ranges === -1) {
      // Set content-range
      context.set('Content-Range', `bytes */${stats.size}`);

      // Unsatisfiable 416
      return context.throw(416);
    }

    // 400
    if (ranges === -2) {
      return context.throw(400);
    }

    // Ranges length
    let { length } = ranges;

    // Set stream body, highWaterMark 64kb
    const stream = new PassThrough({ highWaterMark: 65536 });

    // Set response body
    context.body = stream;

    // Read file ranges
    try {
      for (const range of ranges) {
        await this.read(path, range, stream, --length === 0);
      }
    } catch (error) {
      // End stream when read exception
      stream.end();
    }

    return true;
  }
}
