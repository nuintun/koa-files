/**
 * @module index
 * @license MIT
 * @author nuintun
 */

// import ms from 'ms';
// import etag from 'etag';
import { Stats } from 'fs';
import { join } from 'path';
import { Context, Middleware, Next } from 'koa';
import parseRange, { Range as PRange, Ranges as PRanges } from 'range-parser';
import { boundaryGenerator, fstat, isOutRange, parseTokens, unixify } from './utils';

type DirCallback = (ctx: Context, path: string) => void;
type Ignore = false | ((path: string) => false | 'deny' | 'ignore');
type ErrorCallback = (ctx: Context, status: number, message: string) => void;

export interface Options {
  acceptRanges?: boolean;
  cacheControl?: boolean;
  etag?: boolean;
  ignore?: Ignore;
  immutable?: boolean;
  index?: string | string[] | false;
  lastModified?: boolean;
  maxAge?: string | number;
  ondir?: DirCallback;
  onerror?: ErrorCallback;
}

interface Range {
  start: number;
  end: number;
  prefix?: string;
  suffix?: string;
}

type Ranges = -1 | -2 | Range[];

class Send {
  private ctx: Context;
  private root: string;
  private path: string;
  private options: Options;

  constructor(ctx: Context, root: string, options: Options) {
    this.ctx = ctx;
    this.root = root;
    this.options = options;
    this.path = unixify(join(root, ctx.path));

    this.run();
  }

  private hasTrailingSlash(): boolean {
    return /\/$/.test(this.path);
  }

  private isConditionalGET(): boolean {
    const { request }: Context = this.ctx;

    return !!(
      request.get('If-Match') ||
      request.get('If-None-Match') ||
      request.get('If-Modified-Since') ||
      request.get('if-Unmodified-Since')
    );
  }

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

  private isCachable(): boolean {
    const { status }: Context = this.ctx;

    return status === 304 || (status >= 200 && status < 300);
  }

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

  private error(status: number): void {
    const { ctx, options }: Send = this;

    if (typeof options.onerror === 'function') {
      options.onerror(ctx, status, ctx.message);
    } else {
      ctx.throw(status);
    }
  }

  private statError(error: NodeJS.ErrnoException): void {
    this.error(/^(ENOENT|ENAMETOOLONG|ENOTDIR)$/i.test(error.code) ? 404 : 500);
  }

  private dir(): void {
    const { ctx, path, options }: Send = this;

    if (typeof options.ondir === 'function') {
      options.ondir(ctx, path);
    } else {
      this.error(403);
    }
  }

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

            ctx.type = `multipart/byteranges; boundary=${boundary}`;

            // Map ranges
            ranges.forEach(({ start, end }: PRange): void => {
              // Set fields
              const contentType: string = 'Content-Type: application/octet-stream';
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

  private async run(): Promise<any> {
    const { ctx, root, path, options }: Send = this;
    const { method, response }: Context = ctx;
    const { ignore }: Options = options;

    // Only support GET and HEAD
    if (method !== 'GET' && method !== 'HEAD') {
      return this.error(405);
    }

    if (path.includes('\0') || isOutRange(path, root)) {
      // Malicious path or null byte(s)
      return this.error(403);
    }

    // Is ignore path or file
    switch (typeof ignore === 'function' ? ignore(this.path) : ignore) {
      case 'deny':
        return this.error(403);
      case 'ignore':
        return this.error(404);
    }

    ctx.status = 200;

    try {
      const stats: Stats = await fstat(path);

      // Is directory
      if (stats.isDirectory()) {
        // return this.sendIndex();
      } else if (this.hasTrailingSlash()) {
        // Not a directory but has trailing slash
        return this.error(404);
      }

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

        // Read file
        // this.sendFile(ranges);
      }
    } catch (error) {
      return this.statError(error);
    }
  }
}

export default function server(root: string, options: Options): Middleware {
  return async (ctx: Context, next: Next): Promise<Send> => new Send(ctx, root, options);
}
