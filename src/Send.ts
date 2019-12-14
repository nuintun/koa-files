/**
 * @module Send
 * @license MIT
 * @author nuintun
 */

import etag from 'etag';
import { Context } from 'koa';
import destroy from 'destroy';
import { PassThrough } from 'stream';
import fs, { ReadStream, Stats } from 'fs';
import { extname, join, resolve } from 'path';
import parseRange, { Range as PRange, Ranges as PRanges } from 'range-parser';
import { boundaryGenerator, decodeURI, fstat, hasTrailingSlash, isETag, isETagFresh, isOutRange, unixify } from './utils';

export type Ignore = false | ((path: string) => boolean);

export interface Options {
  acceptRanges?: boolean;
  cacheControl?: boolean;
  etag?: boolean;
  ignore?: Ignore;
  immutable?: boolean;
  lastModified?: boolean;
  maxAge?: number;
}

interface Range {
  start: number;
  end?: number;
  prefix?: string;
  suffix?: string;
}

type Ranges = Range[] | -1 | -2;

// Default options
const defaultOptions: Options = {
  maxAge: 31557600000
};

/**
 * @class Send
 */
export default class Send {
  private ctx: Context;
  private root: string;
  private options: Options;
  private path: string | -1;

  /**
   * @constructor
   * @param {Context} ctx
   * @param {string} root
   * @param {Options} options
   */
  constructor(ctx: Context, root: string = '.', options: Options) {
    this.ctx = ctx;
    this.root = unixify(resolve(root));
    this.options = { ...defaultOptions, ...options };

    // Decode path
    const path: string | -1 = decodeURI(ctx.path);

    // Get real path
    this.path = path === -1 ? -1 : unixify(join(this.root, path));
  }

  /**
   * @method isConditionalGET
   * @returns {boolean}
   */
  private isConditionalGET(): boolean {
    const { request }: Context = this.ctx;

    return !!(
      request.get('If-Match') ||
      request.get('If-None-Match') ||
      request.get('If-Modified-Since') ||
      request.get('if-Unmodified-Since')
    );
  }

  /**
   * @method isPreconditionFailure
   * @returns {boolean}
   */
  private isPreconditionFailure(): boolean {
    const { request, response }: Context = this.ctx;

    // If-Match
    const match: string = request.get('If-Match');

    if (match) {
      const etag: string = response.get('ETag');

      return !etag || (match !== '*' && !isETagFresh(match, etag));
    }

    // If-Unmodified-Since
    const unmodifiedSince: number = Date.parse(request.get('If-Unmodified-Since'));

    if (!isNaN(unmodifiedSince)) {
      const lastModified: number = Date.parse(response.get('Last-Modified'));

      return isNaN(lastModified) || lastModified > unmodifiedSince;
    }

    return false;
  }

  /**
   * @method isRangeFresh
   * @returns {boolean}
   */
  private isRangeFresh(): boolean {
    const { request, response }: Context = this.ctx;
    const ifRange: string = request.get('If-Range');

    if (!ifRange) return true;

    // If-Range as etag
    if (isETag(ifRange)) {
      const etag: string = response.get('ETag');

      return !!(etag && isETagFresh(ifRange, etag));
    }

    // If-Range as modified date
    const lastModified: string = response.get('Last-Modified');

    return Date.parse(lastModified) <= Date.parse(ifRange);
  }

  /**
   * @method isIgnore
   * @param {string} path
   * @returns {boolean}
   */
  private isIgnore(path: string): boolean {
    const { ignore }: Options = this.options;

    return (typeof ignore === 'function' ? ignore(path) : false) === true;
  }

  /**
   * @method parseRange
   * @param {Stats} stats
   * @returns {Ranges}
   */
  private parseRange(stats: Stats): Ranges {
    const { ctx }: Send = this;
    const result: Range[] = [];
    const { size }: Stats = stats;
    const { request }: Context = ctx;

    // Content-Length
    let contentLength: number = size;

    // Range support
    if (this.options.acceptRanges !== false) {
      const range: string = request.get('Range');

      // Range fresh
      if (range && this.isRangeFresh()) {
        // Parse range -1 -2 or []
        const ranges: -1 | -2 | PRanges = parseRange(size, range, { combine: true });

        // Valid ranges, support multiple ranges
        if (Array.isArray(ranges) && ranges.type === 'bytes') {
          // Set 206 status
          ctx.status = 206;

          // Multiple ranges
          if (ranges.length > 1) {
            // Reset content-length
            contentLength = 0;

            // Range boundary
            const boundary: string = `<${boundaryGenerator()}>`;
            const suffix: string = `\r\n--${boundary}--\r\n`;
            const contentType: string = `Content-Type: ${ctx.type}`;

            ctx.type = `multipart/byteranges; boundary=${boundary}`;

            // Map ranges
            ranges.forEach(({ start, end }: PRange, index: number): void => {
              // The first prefix boundary no \r\n
              const prefixHead: string = index > 0 ? '\r\n' : '';
              const contentRange: string = `Content-Range: bytes ${start}-${end}/${size}`;
              const prefix: string = `${prefixHead}--${boundary}\r\n${contentType}\r\n${contentRange}\r\n\r\n`;

              // Compute content-length
              contentLength += end - start + 1 + Buffer.byteLength(prefix);

              // Cache range
              result.push({ start, end, prefix });
            });

            // The last add suffix boundary
            result[result.length - 1].suffix = suffix;
            // Compute content-length
            contentLength += Buffer.byteLength(suffix);
          } else {
            const { start, end }: PRange = ranges[0];

            ctx.set('Content-Range', `bytes ${start}-${end}/${size}`);

            // Compute content-length
            contentLength = end - start + 1;

            // Cache range
            result.push({ start, end });
          }
        } else {
          return ranges;
        }
      }
    }

    // Set Content-Length
    ctx.length = contentLength;

    return result.length ? result : [{ start: 0 }];
  }

  /**
   * @method setupHeaders
   * @param {string} path
   * @param {Stats} stats
   */
  private setupHeaders(path: string, stats: Stats): void {
    const { ctx, options }: Send = this;

    // Set status
    ctx.status = 200;

    // Accept-Ranges
    if (options.acceptRanges !== false) {
      // Set Accept-Ranges
      ctx.set('Accept-Ranges', 'bytes');
    }

    // Set Content-Type
    ctx.type = extname(path);

    // Cache-Control
    if (options.cacheControl !== false) {
      // Get maxAge
      const maxAge: number = Math.floor((Math.abs(options.maxAge) || defaultOptions.maxAge) / 1000);

      // Get Cache-Control
      let cacheControl: string = `public, max-age=${maxAge}`;

      // Immutable
      if (options.immutable) {
        cacheControl += ', immutable';
      }

      // Set Cache-Control
      ctx.set('Cache-Control', cacheControl);
    }

    // Last-Modified
    if (options.lastModified !== false) {
      // Get mtime utc string
      ctx.set('Last-Modified', stats.mtime.toUTCString());
    }

    // ETag
    if (options.etag !== false) {
      // Set ETag
      ctx.set('ETag', etag(stats));
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
    return new Promise((resolve, reject) => {
      // Write prefix boundary
      range.prefix && buffer.write(range.prefix);

      // Create file stream
      const file: ReadStream = fs.createReadStream(path, range);

      // Error handling code-smell
      file.on('error', (error: NodeJS.ErrnoException): void => {
        // Unpipe
        file.unpipe(buffer);
        // Destroy file stream
        destroy(file);
        // Reject
        reject(error);
      });

      // File read stream close
      file.on('close', (): void => {
        // Unpipe
        file.unpipe(buffer);
        // Push suffix boundary
        range.suffix && buffer.write(range.suffix);
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
   * @method send
   * @param {string} path
   * @param {Range[]} ranges
   */
  private async send(path: string, ranges: Range[]): Promise<void> {
    const { ctx }: Send = this;

    // Set stream body, highWaterMark 64kb
    ctx.body = new PassThrough({ highWaterMark: 65536 });

    // Ranges count
    let count: number = ranges.length;

    // Read file ranges
    try {
      for (const range of ranges) {
        await this.read(path, range, ctx.body, --count === 0);
      }
    } catch (error) {
      // Header already sent
      if (ctx.headerSent) {
        // End stream
        ctx.body.end();
      } else {
        // 404 | 500
        ctx.throw(/^(ENOENT|ENAMETOOLONG|ENOTDIR)$/i.test(error.code) ? 404 : 500);
      }
    }
  }

  /**
   * @method start
   * @returns {Promise<boolean>}
   */
  public async start(): Promise<boolean | never> {
    const { ctx, root, path }: Send = this;
    const { method, response }: Context = ctx;

    // Only support GET and HEAD
    if (method !== 'GET' && method !== 'HEAD') {
      // 405
      return false;
    }

    // Path -1 or null byte(s)
    if (path === -1 || path.includes('\0')) {
      return ctx.throw(400);
    }

    // Malicious path
    if (isOutRange(path, root)) {
      // 403
      return false;
    }

    // Is ignore path or file
    if (this.isIgnore(path)) {
      // 403 | 404
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

    // File exist
    if (stats) {
      // Is directory
      if (stats.isDirectory()) {
        // 403
        return false;
      } else if (hasTrailingSlash(path)) {
        // 404
        // Not a directory but has trailing slash
        return false;
      }

      // Setup headers
      this.setupHeaders(path, stats);

      // Conditional get support
      if (this.isConditionalGET()) {
        if (this.isPreconditionFailure()) {
          // Remove content-type
          response.remove('Content-Type');

          // 412
          ctx.status = 412;

          return true;
        } else if (ctx.fresh) {
          // Remove content-type
          response.remove('Content-Type');

          // 304
          ctx.status = 304;

          return true;
        }
      }

      // Head request
      if (method === 'HEAD') {
        // Set content-length
        ctx.length = stats.size;

        return true;
      }

      // Parse ranges
      const ranges: Ranges = this.parseRange(stats);

      // 416
      if (ranges === -1) {
        // Set content-range
        ctx.set('Content-Range', `bytes */${stats.size}`);

        // Unsatisfiable 416
        return ctx.throw(416);
      }

      // 400
      if (ranges === -2) {
        return ctx.throw(400);
      }

      // Send file
      this.send(path, ranges);

      return true;
    }

    return false;
  }
}
