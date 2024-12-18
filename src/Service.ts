/**
 * @module Service
 */

import createETag from 'etag';
import { Context } from 'koa';
import fs, { Stats } from 'fs';
import { ReadStream } from './ReadStream';
import { isFunction } from './utils/type';
import { FileSystem, stat } from './utils/fs';
import { extname, join, resolve } from 'path';
import { hasTrailingSlash, isOutRoot, unixify } from './utils/path';
import { decodeURI, isConditionalGET, isPreconditionFailed, parseRanges } from './utils/http';

interface Headers {
  [key: string]: string | string[];
}

interface IgnoreFunction {
  (path: string): boolean | Promise<boolean>;
}

interface HeadersFunction {
  (path: string, stats: Stats): Promise<Headers | void> | Headers | void;
}

export interface Options {
  fs?: FileSystem;
  etag?: boolean;
  acceptRanges?: boolean;
  lastModified?: boolean;
  highWaterMark?: number;
  ignore?: IgnoreFunction;
  headers?: Headers | HeadersFunction;
}

/**
 * @class Service
 */
export class Service {
  private readonly root: string;
  private readonly options: Options & { fs: FileSystem };

  /**
   * @constructor
   * @description Create file service.
   * @param root The file service root.
   * @param options The file service options.
   */
  constructor(root: string, options?: Options) {
    this.root = unixify(resolve(root));
    this.options = { fs, highWaterMark: 65536, ...options };
  }

  /**
   * @private
   * @method isIgnore
   * @description Check if path is ignore.
   * @param path The path to check.
   */
  private async isIgnore(path: string): Promise<boolean> {
    const { ignore } = this.options;
    const isIgnored = isFunction(ignore) ? await ignore(path) : false;

    return isIgnored === true;
  }

  /**
   * @private
   * @method setupHeaders
   * @description Setup headers.
   * @param context The koa context.
   * @param path The file path.
   * @param stats The file stats.
   */
  private async setupHeaders({ response }: Context, path: string, stats: Stats): Promise<void> {
    const { options } = this;
    const { headers } = options;

    // Set status.
    response.status = 200;

    // Set Content-Type.
    response.type = extname(path);

    // Set headers.
    if (headers) {
      if (isFunction(headers)) {
        const fields = await headers(path, stats);

        if (fields) {
          response.set(fields);
        }
      } else {
        response.set(headers);
      }
    }

    // Accept-Ranges.
    if (options.acceptRanges === false) {
      // Set Accept-Ranges to none tell client not support.
      response.set('Accept-Ranges', 'none');
    } else {
      // Set Accept-Ranges.
      response.set('Accept-Ranges', 'bytes');
    }

    // ETag.
    if (options.etag === false) {
      // Remove ETag.
      response.remove('ETag');
    } else if (!response.get('ETag')) {
      // Set weak ETag.
      response.set('ETag', createETag(stats));
    }

    // Last-Modified.
    if (options.lastModified === false) {
      // Remove Last-Modified.
      response.remove('Last-Modified');
    } else if (!response.get('Last-Modified')) {
      // Set last modified from mtime.
      response.set('Last-Modified', stats.mtime.toUTCString());
    }
  }

  /**
   * @public
   * @method respond
   * @description Respond file.
   * @param context The koa context.
   */
  public async respond(context: Context): Promise<boolean> {
    const { request } = context;
    const { method } = request;

    // Only support GET and HEAD (405).
    if (method !== 'GET' && method !== 'HEAD') {
      return false;
    }

    // Get pathname of file.
    const pathname = decodeURI(request.path);

    // Pathname decode failed or includes null byte(s).
    if (pathname === -1 || pathname.includes('\0')) {
      return context.throw(400);
    }

    // Get service root.
    const { root } = this;
    // Get file path.
    const path = unixify(join(root, pathname));

    // Malicious path (403).
    if (isOutRoot(path, root)) {
      return false;
    }

    // Is ignore path or file (403).
    if (await this.isIgnore(path)) {
      return false;
    }

    // Get options.
    const { options } = this;
    // File stats.
    const stats = await stat(options.fs, path);

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

    // Koa response.
    const { response } = context;

    // Setup headers.
    await this.setupHeaders(context, path, stats);

    // Conditional get support.
    if (isConditionalGET(context)) {
      // Request precondition failed.
      if (isPreconditionFailed(context)) {
        return context.throw(412);
      }

      // Request fresh (304).
      if (request.fresh) {
        // Set status.
        response.status = 304;
        // Set body null.
        response.body = null;

        // File found.
        return true;
      }
    }

    // Head request.
    if (method === 'HEAD') {
      // Set Content-Length.
      response.length = stats.size;
      // Set body null
      response.body = null;

      // File found.
      return true;
    }

    // Parsed ranges.
    const ranges = parseRanges(context, stats);

    // 416
    if (ranges === -1) {
      // Set Content-Range.
      response.set('Content-Range', `bytes */${stats.size}`);

      // Unsatisfiable 416.
      return context.throw(416);
    }

    // 400.
    if (ranges === -2) {
      return context.throw(400);
    }

    // Set response body.
    response.body = new ReadStream(path, ranges, options);

    // File found.
    return true;
  }
}
