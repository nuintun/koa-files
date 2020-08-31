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
import { boundaryGenerator, decodeURI, fstat, hasTrailingSlash, isETag, isETagFresh, isOutRoot, unixify } from './utils';

export type Ignore = false | ((path: string) => boolean);

export interface Options {
  etag?: boolean;
  ignore?: Ignore;
  acceptRanges?: boolean;
  lastModified?: boolean;
  cacheControl?: false | string;
}

interface Range {
  start: number;
  end?: number;
  prefix?: string;
  suffix?: string;
}

type Ranges = Range[] | -1 | -2;

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
    let { cacheControl }: Options = options;

    const path: string | -1 = decodeURI(ctx.path);
    const { toString }: Object = Object.prototype;

    if (cacheControl !== false && toString.call(cacheControl) !== '[object String]') {
      cacheControl = 'public, max-age=31557600';
    }

    this.ctx = ctx;
    this.root = unixify(resolve(root));
    this.options = { ...options, cacheControl };
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

    // No If-Range
    if (!ifRange) {
      return true;
    }

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

        // -1 signals an unsatisfiable range
        // -2 signals a malformed header string
        if (ranges === -1 || ranges === -2) {
          return ranges;
        }

        // Ranges ok, support multiple ranges
        if (ranges.type === 'bytes') {
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

    // Set Content-Type
    ctx.type = extname(path);

    // Accept-Ranges
    if (options.acceptRanges !== false) {
      // Set Accept-Ranges
      ctx.set('Accept-Ranges', 'bytes');
    }

    // Cache-Control
    if (options.cacheControl !== false) {
      // Set Cache-Control
      ctx.set('Cache-Control', options.cacheControl);
    }

    // Last-Modified
    if (options.lastModified !== false) {
      // Set mtime utc string
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
    type Resolve = (value: true) => void;
    type Reject = (reason: NodeJS.ErrnoException) => void;

    return new Promise((resolve: Resolve, reject: Reject): void => {
      // Create file stream
      const file: ReadStream = fs.createReadStream(path, range);

      // File read stream open
      if (range.prefix) {
        file.once('open', (): void => {
          // Write prefix boundary
          buffer.write(range.prefix);
        });
      }

      // File read stream error
      file.once('error', (error: NodeJS.ErrnoException): void => {
        // Unpipe
        file.unpipe(buffer);
        // Destroy file stream
        destroy(file);
        // Reject
        reject(error);
      });

      // File read stream end
      if (range.suffix) {
        file.once('end', (): void => {
          // Push suffix boundary
          buffer.write(range.suffix);
        });
      }

      // File read stream close
      file.once('close', (): void => {
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
      // End stream when read exception
      ctx.body.end();
    }
  }

  /**
   * @method response
   * @returns {Promise<boolean>}
   */
  public async response(): Promise<boolean> {
    const { ctx, root, path }: Send = this;

    // Only support GET and HEAD (405)
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
      return false;
    }

    // Path -1 or null byte(s)
    if (path === -1 || path.includes('\0')) {
      return ctx.throw(400);
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
    this.setupHeaders(path, stats);

    // Conditional get support
    if (this.isConditionalGET()) {
      // Request precondition failure
      if (this.isPreconditionFailure()) {
        return ctx.throw(412);
      }

      // Request fresh (304)
      if (ctx.fresh) {
        // Set status
        ctx.status = 304;
        // Set body null
        ctx.body = null;

        return true;
      }
    }

    // Head request
    if (ctx.method === 'HEAD') {
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
}
