/**
 * @module Service
 */

import { Stats } from 'fs';
import createETag from 'etag';
import { Context } from 'koa';
import { FileSystem, stat } from './utils/fs';
import { extname, join, resolve } from 'path';
import { FileReadStream } from './utils/stream';
import { hasTrailingSlash, isOutRoot, unixify } from './utils/path';
import { decodeURI, isConditionalGET, isPreconditionFailure, parseRanges } from './utils/http';

interface IgnoreFunction {
  (path: string): boolean;
}

interface Headers {
  [key: string]: string | string[];
}

interface HeaderFunction {
  (path: string, stats: Stats): Headers | void;
}

export interface Options {
  fs: FileSystem;
  etag?: boolean;
  acceptRanges?: boolean;
  lastModified?: boolean;
  highWaterMark?: number;
  ignore?: IgnoreFunction;
  headers?: Headers | HeaderFunction;
}

/**
 * @function isFunction
 * @description Check if value is function.
 * @param value The value to check.
 */
function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}

/**
 * @class Service
 */
export default class Service {
  private root: string;
  private options: Options;

  /**
   * @constructor
   * @description Create file service.
   * @param root The file service root.
   * @param options The file service options.
   */
  constructor(root: string, options: Options) {
    this.options = options;
    this.root = unixify(resolve(root));
  }

  /**
   * @private
   * @method isIgnore
   * @description Check if path is ignore.
   * @param path The path to check.
   */
  private isIgnore(path: string): boolean {
    const { ignore } = this.options;

    return (isFunction(ignore) ? ignore(path) : false) === true;
  }

  /**
   * @private
   * @method setupHeaders
   * @description Setup headers.
   * @param context The koa context.
   * @param path The file path.
   * @param stats The file stats.
   */
  private setupHeaders(context: Context, path: string, stats: Stats): void {
    const { options } = this;
    const { headers, etag } = options;

    // Set status.
    context.status = 200;

    // Set Content-Type.
    context.type = extname(path);

    // Accept-Ranges.
    if (options.acceptRanges === false) {
      // Set Accept-Ranges to none tell client not support.
      context.set('Accept-Ranges', 'none');
    } else {
      // Set Accept-Ranges.
      context.set('Accept-Ranges', 'bytes');
    }

    // ETag.
    if (etag === false) {
      // Remove ETag.
      context.remove('ETag');
    } else {
      context.set('ETag', createETag(stats));
    }

    // Last-Modified.
    if (options.lastModified === false) {
      // Remove Last-Modified.
      context.remove('Last-Modified');
    } else {
      // Set mtime utc string.
      context.set('Last-Modified', stats.mtime.toUTCString());
    }

    // Set headers.
    if (headers) {
      if (isFunction(headers)) {
        const fields = headers(path, stats);

        if (fields) {
          context.set(fields);
        }
      } else {
        context.set(headers);
      }
    }
  }

  /**
   * @public
   * @method respond
   * @description Respond file.
   * @param context The koa context.
   */
  public async respond(context: Context): Promise<boolean> {
    const { root } = this;

    // Only support GET and HEAD (405).
    if (context.method !== 'GET' && context.method !== 'HEAD') {
      return false;
    }

    // Get pathname of file.
    const pathname = decodeURI(context.path);

    // Pathname decode failed or includes null byte(s).
    if (pathname === -1 || pathname.includes('\0')) {
      return context.throw(400);
    }

    const path = unixify(join(root, pathname));

    // Malicious path (403).
    if (isOutRoot(path, root)) {
      return false;
    }

    // Is ignore path or file (403).
    if (this.isIgnore(path)) {
      return false;
    }

    // File stats.
    const stats = await stat(this.options.fs, path);

    // Check file stats.
    if (
      // File not exist (404 | 500).
      stats == null ||
      // Is directory (403).
      stats.isDirectory() ||
      // Not a directory but has trailing slash (404).
      hasTrailingSlash(path)
    ) {
      return false;
    }

    // Setup headers.
    this.setupHeaders(context, path, stats);

    // Conditional get support.
    if (isConditionalGET(context)) {
      // Request precondition failure.
      if (isPreconditionFailure(context)) {
        return context.throw(412);
      }

      // Request fresh (304).
      if (context.fresh) {
        // Set status.
        context.status = 304;
        // Set body null.
        context.body = null;

        // File found.
        return true;
      }
    }

    // Head request.
    if (context.method === 'HEAD') {
      // Set Content-Length.
      context.length = stats.size;
      // Set body null
      context.body = null;

      // File found.
      return true;
    }

    // Parsed ranges.
    const ranges = parseRanges(context, stats);

    // 416
    if (ranges === -1) {
      // Set Content-Range.
      context.set('Content-Range', `bytes */${stats.size}`);

      // Unsatisfiable 416.
      return context.throw(416);
    }

    // 400.
    if (ranges === -2) {
      return context.throw(400);
    }

    // Ranges length.
    const { fs, highWaterMark } = this.options;

    // Set response body.
    context.body = new FileReadStream(path, ranges, { fs, highWaterMark });

    // File found.
    return true;
  }
}
