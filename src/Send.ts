import ms from 'ms';
import etag from 'etag';
import { Context } from 'koa';
import destroy from 'destroy';
import through from './through';
import { Transform } from 'stream';
import fs, { ReadStream, Stats } from 'fs';
import { extname, join, resolve } from 'path';
import parseRange, { Range as PRange, Ranges as PRanges } from 'range-parser';
import { boundaryGenerator, fstat, hasTrailingSlash, isOutRange, parseTokens, unixify } from './utils';

export type DirCallback = (ctx: Context, path: string) => void;
export type Ignore = false | ((path: string) => false | 'deny' | 'ignore');
export type ErrorCallback = (ctx: Context, status: number, message: string) => void;

export interface Options {
  acceptRanges?: boolean;
  cacheControl?: boolean;
  etag?: boolean;
  ignore?: Ignore;
  immutable?: boolean;
  lastModified?: boolean;
  maxAge?: string;
  ondir?: DirCallback;
  onerror?: ErrorCallback;
}

interface Range {
  start: number;
  end: number;
  prefix?: string;
  suffix?: string;
}

type Ranges = Range[] | -1 | -2;

const defaultOptions: Options = {
  maxAge: '1y'
};

export default class Send {
  private ctx: Context;
  private root: string;
  private options: Options;
  private path: string | -1;
  private buffer: Transform;

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
    this.path = (path as string | -1) === -1 ? -1 : unixify(join(this.root, path));
    // Buffer
    this.buffer = through();
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
    const match = request.get('If-Match');

    if (match) {
      const etag = response.get('ETag');

      return (
        !etag ||
        (match !== '*' &&
          parseTokens(match).every((match: string): boolean => {
            return match !== etag && match !== 'W/' + etag && 'W/' + match !== etag;
          }))
      );
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
   * @method isCachable
   * @returns {boolean}
   */
  private isCachable(): boolean {
    const { status }: Context = this.ctx;

    return status === 304 || (status >= 200 && status < 300);
  }

  /**
   * @method isRangeFresh
   * @returns {boolean}
   */
  private isRangeFresh(): boolean {
    const { request, response }: Context = this.ctx;
    const ifRange = request.get('If-Range');

    if (!ifRange) return true;

    // If-Range as etag
    if (ifRange.indexOf('"') !== -1) {
      const etag = response.get('ETag');

      return !!(etag && ifRange.indexOf(etag) !== -1);
    }

    // If-Range as modified date
    const lastModified = response.get('Last-Modified');

    return Date.parse(lastModified) <= Date.parse(ifRange);
  }

  /**
   * @method error
   * @param {number} status
   */
  private error(status: number): void {
    const { ctx, options }: Send = this;

    if (typeof options.onerror === 'function') {
      options.onerror(ctx, status, ctx.message);
    } else {
      ctx.throw(status);
    }
  }

  /**
   * @method statError
   * @param {ErrnoException} error
   */
  private statError(error: NodeJS.ErrnoException): void {
    this.error(/^(ENOENT|ENAMETOOLONG|ENOTDIR)$/i.test(error.code) ? 404 : 500);
  }

  /**
   * @method dir
   * @param {string} path
   */
  private dir(path: string): void {
    const { ctx, options }: Send = this;

    if (typeof options.ondir === 'function') {
      options.ondir(ctx, path);
    } else {
      this.error(403);
    }
  }

  /**
   * @method parseRange
   * @param {Stats} stats
   * @returns {Ranges}
   */
  private parseRange(stats: Stats): Ranges {
    const { ctx }: Send = this;
    const { request }: Context = ctx;

    const result: Range[] = [];
    const { size }: Stats = stats;

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
          ctx.status = 206;

          // Multiple ranges
          if (ranges.length > 1) {
            // Reset content-length
            contentLength = 0;

            // Range boundary
            const boundary = `<${boundaryGenerator()}>`;
            const suffix: string = `\r\n--${boundary}--\r\n`;
            const contentType: string = `Content-Type: ${ctx.type}`;

            ctx.type = `multipart/byteranges; boundary=${boundary}`;

            // Map ranges
            ranges.forEach(({ start, end }: PRange): void => {
              const contentRange: string = `Content-Range: bytes ${start}-${end}/${size}`;
              const prefix: string = `\r\n--${boundary}\r\n${contentType}\r\n${contentRange}\r\n\r\n`;

              // Compute content-length
              contentLength += end - start + Buffer.byteLength(prefix) + 1;

              // Cache range
              result.push({ start, end, prefix });
            });

            // The first prefix boundary remove \r\n
            result[0].prefix = result[0].prefix.replace(/^\r\n/, '');
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

    ctx.length = contentLength;

    return result.length ? result : [{ start: 0, end: size }];
  }

  /**
   * @method setupHeaders
   * @param {string} path
   * @param {Stats} stats
   */
  private setupHeaders(path: string, stats: Stats): void {
    const { ctx, options }: Send = this;

    // Accept-Ranges
    if (options.acceptRanges !== false) {
      // Set Accept-Ranges
      ctx.set('Accept-Ranges', 'bytes');
    }

    // Set Content-Type
    ctx.type = extname(path);

    // Cache-Control
    if (options.cacheControl !== false) {
      let cacheControl = `public, max-age=${ms(options.maxAge) / 1000}`;

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
   * @returns {Promise<true>}
   */
  private read(path: string, range: Range): Promise<true> {
    const { buffer }: Send = this;

    return new Promise((resolve, reject) => {
      // Write prefix boundary
      range.prefix && buffer.write(range.prefix);

      // Create file stream
      const file: ReadStream = fs.createReadStream(path, range);

      // Write data to buffer
      file.on('data', (chunk: any) => {
        buffer.write(chunk);
      });

      // Error handling code-smell
      file.on('error', error => {
        // Reject
        reject(error);
      });

      // File stream close
      file.on('close', () => {
        // Push suffix boundary
        range.suffix && buffer.write(range.suffix);
        // Destroy file stream
        destroy(file);
        // Resolve
        resolve(true);
      });
    });
  }

  /**
   * @method start
   * @returns {Promise<any>}
   */
  public async start(): Promise<any> {
    const { ctx, root, path, buffer, options }: Send = this;
    const { method, response }: Context = ctx;
    const { ignore }: Options = options;

    // Only support GET and HEAD
    if (method !== 'GET' && method !== 'HEAD') {
      return this.error(405);
    }

    // Path -1 or null byte(s)
    if (path === -1 || path.includes('\0')) {
      return this.error(400);
    }

    // Malicious path
    if (isOutRange(path, root)) {
      return this.error(403);
    }

    // Is ignore path or file
    switch (typeof ignore === 'function' ? ignore(path) : false) {
      case 'deny':
        return this.error(403);
      case 'ignore':
        return this.error(404);
    }

    let stats: Stats;

    try {
      stats = await fstat(path);
    } catch (error) {
      return this.statError(error);
    }

    if (stats) {
      // Is directory
      if (stats.isDirectory()) {
        return this.dir(path);
      } else if (hasTrailingSlash(path)) {
        // Not a directory but has trailing slash
        return this.error(404);
      }

      // Setup headers
      this.setupHeaders(path, stats);

      // Conditional get support
      if (this.isConditionalGET()) {
        const responseEnd: () => void = () => {
          // Remove content-type
          response.remove('Content-Type');

          // End with empty content
          ctx.body = null;
        };

        if (this.isPreconditionFailure()) {
          ctx.status = 412;

          return responseEnd();
        } else if (this.isCachable() && ctx.fresh) {
          ctx.status = 304;

          return responseEnd();
        }
      }

      // Head request
      if (method === 'HEAD') {
        // Set content-length
        ctx.length = stats.size;

        // End with empty content
        return (ctx.body = null);
      }

      // Parse ranges
      const ranges: Ranges = this.parseRange(stats);

      // 416
      if (ranges === -1) {
        // Set content-range
        ctx.set('Content-Range', `bytes */${stats.size}`);

        // Unsatisfiable 416
        return this.error(416);
      }

      // 400
      if (ranges === -2) {
        return this.error(400);
      }

      // Set stream body
      ctx.body = buffer;

      // Read file ranges
      for (const range of ranges) {
        await this.read(path, range);
      }

      // End stream
      buffer.end();
    }
  }
}
