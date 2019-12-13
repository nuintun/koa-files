import ms from 'ms';
import etag from 'etag';
import { Context } from 'koa';
import destroy from 'destroy';
import { PassThrough } from 'stream';
import fs, { ReadStream, Stats } from 'fs';
import { extname, join, resolve } from 'path';
import parseRange, { Range as PRange, Ranges as PRanges } from 'range-parser';
import { boundaryGenerator, fstat, hasTrailingSlash, isOutRange, parseTokens, unixify } from './utils';

export type Ignore = false | ((path: string) => boolean);

export interface Options {
  acceptRanges?: boolean;
  cacheControl?: boolean;
  etag?: boolean;
  ignore?: Ignore;
  immutable?: boolean;
  lastModified?: boolean;
  maxAge?: string;
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
  private buffer: PassThrough;

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
    this.buffer = new PassThrough();
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

      return (
        !etag ||
        (match !== '*' &&
          parseTokens(match).every((match: string): boolean => {
            return match !== etag && match !== 'W/' + etag && 'W/' + match !== etag;
          }))
      );
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
    if (ifRange.includes('"')) {
      const etag: string = response.get('ETag');

      return !!(etag && ifRange.includes(etag));
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
          // Set 206 status
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
      // Drain handle
      const ondrain: () => ReadStream = (): ReadStream => file.resume();

      // Bind drain handle
      buffer.on('drain', ondrain);

      // Write data to buffer
      file.on('readable', (): void => {
        // Read data
        const chunk: any = file.read();

        // Write data
        chunk !== null && !buffer.write(chunk) && file.pause();
      });

      // Error handling code-smell
      file.on('error', (error: NodeJS.ErrnoException): void => reject(error));

      // File read stream close
      file.on('close', (): void => {
        // Push suffix boundary
        range.suffix && buffer.write(range.suffix);
        // Remove drain handle
        buffer.removeListener('drain', ondrain);
        // Destroy file stream
        destroy(file);
        // Resolve
        resolve(true);
      });
    });
  }

  /**
   * @method start
   * @returns {Promise<boolean>}
   */
  public async start(): Promise<boolean | never> {
    const { ctx, root, path, buffer }: Send = this;
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
        const responseEnd: () => true = () => {
          // Remove content-type
          response.remove('Content-Type');

          // End with empty content
          ctx.body = null;

          return true;
        };

        if (this.isPreconditionFailure()) {
          ctx.status = 412;

          return responseEnd();
        } else if (ctx.fresh) {
          ctx.status = 304;

          return responseEnd();
        }
      }

      // Head request
      if (method === 'HEAD') {
        // Set content-length
        ctx.length = stats.size;
        // End with empty content
        ctx.body = null;

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

      // Set stream body
      ctx.body = buffer;

      // Read file ranges
      try {
        for (const range of ranges) {
          await this.read(path, range);
        }
      } catch (error) {
        return ctx.throw(/^(ENOENT|ENAMETOOLONG|ENOTDIR)$/i.test(error.code) ? 404 : 500);
      }

      // End stream
      buffer.end();

      return true;
    }

    return false;
  }
}
