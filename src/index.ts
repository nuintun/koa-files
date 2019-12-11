/**
 * @module index
 * @license MIT
 * @author nuintun
 */

// import ms from 'ms';
// import etag from 'etag';
import { Stats } from 'fs';
import { join } from 'path';
import { unixify, parseTokens } from './utils';
import { Context, Next, Middleware } from 'koa';
import parseRange, { Ranges } from 'range-parser';

type DirCallback = (path: string) => string;
type ErrorCallback = (error: Error) => string;
type Ignore = false | ((path: string) => false | 'deny' | 'ignore');

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
  prefix: string;
  suffix?: string;
}

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

  private statError(error: NodeJS.ErrnoException): void {
    this.ctx.throw(/^(ENOENT|ENAMETOOLONG|ENOTDIR)$/i.test(error.code) ? 404 : 500);
  }

  private parseRange(stats: Stats): Range[] {
    const { options, ctx }: Send = this;
    const { request, response }: Context = ctx;

    const result: Range[] = [];
    const { size }: Stats = stats;

    let contentLength: number = size;

    // Range support
    if (this.options.acceptRanges !== false) {
      let range: string = request.get('Range');

      // Range fresh
      if (range && this.isRangeFresh()) {
        // Parse range -1 -2 or []
        const ranges: -1 | -2 | Ranges = parseRange(size, range, { combine: true });

        // Valid ranges, support multiple ranges
        if (Array.isArray(ranges) && ranges.type === 'bytes') {
        }
      }
    }

    return result;
  }
}

export default function server(root: string, options: Options): Middleware {
  return async (ctx: Context, next: Next): Promise<Send> => new Send(ctx, root, options);
}
