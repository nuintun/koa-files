/**
 * @module Files
 */

import { Stats } from 'fs';
import createETag from 'etag';
import destroy from 'destroy';
import { Context } from 'koa';
import { PassThrough } from 'stream';
import { FileSystem, stat } from './utils/fs';
import { extname, join, resolve } from 'path';
import { hasTrailingSlash, isOutRoot, unixify } from './utils/path';
import { decodeURI, isConditionalGET, isPreconditionFailure, parseRanges, Range } from './utils/http';

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
 * @class Files
 */
export default class Files {
  private root: string;
  private options: Options;

  /**
   * @constructor
   * @description Create files service.
   * @param root Files service root.
   * @param options Files service options.
   */
  constructor(root: string, options: Options) {
    this.options = options;
    this.root = unixify(resolve(root));
  }

  /**
   * @private
   * @method isIgnore
   * @description Check if path is ignore.
   * @param path File path.
   */
  private isIgnore(path: string): boolean {
    const { ignore } = this.options;

    return (isFunction(ignore) ? ignore(path) : false) === true;
  }

  /**
   * @private
   * @method setupHeaders
   * @description Setup headers
   * @param context Koa context
   * @param path File path
   * @param stats File stats
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
   * @private
   * @method write
   * @description Write file to stream.
   * @param stream Destination stream.
   * @param path The file path to read.
   * @param range The range to read.
   * @param end Is destory destination stream after read complete.
   */
  private write(stream: PassThrough, path: string, range: Range, end: boolean): Promise<boolean> {
    const { fs } = this.options;

    return new Promise((resolve): void => {
      // Range prefix and suffix.
      const { prefix, suffix } = range;
      // Create file stream reader.
      const reader = fs.createReadStream(path, range);

      // File read stream open.
      if (prefix) {
        reader.once('open', () => {
          // Write prefix boundary.
          stream.write(prefix);
        });
      }

      // File read stream end.
      if (suffix) {
        reader.once('end', () => {
          // Push suffix boundary.
          stream.write(suffix);
        });
      }

      // File read stream error.
      reader.once('error', () => {
        // End stream.
        stream.end();
        // Unpipe.
        reader.unpipe();
        // Destroy.
        destroy(reader);
        // Resolve.
        resolve(false);
      });

      // File read stream close.
      reader.once('close', () => {
        // Unpipe.
        reader.unpipe();
        // Destroy.
        destroy(reader);
        // Resolve.
        resolve(true);
      });

      // Write data to buffer.
      reader.pipe(stream, { end });
    });
  }

  /**
   * @private
   * @method send
   * @description Send file.
   * @param context Koa context.
   * @param path File path.
   * @param ranges Read ranges.
   */
  private async send(context: Context, path: string, ranges: Range[]): Promise<void> {
    // Set stream body, highWaterMark 64kb.
    const stream = new PassThrough({
      highWaterMark: 65536
    });

    // Set response body.
    context.body = stream;

    // Ranges length.
    let { length } = ranges;

    // Write ranges to stream.
    for (const range of ranges) {
      // Write range.
      const passed = await this.write(stream, path, range, --length === 0);

      // If not passed, break.
      if (!passed) {
        break;
      }
    }
  }

  /**
   * @public
   * @method response
   * @description Response to koa context.
   * @param context Koa context.
   */
  public async response(context: Context): Promise<boolean> {
    const { root } = this;

    // Only support GET and HEAD (405).
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

    // Send file.
    this.send(context, path, ranges);

    // File found.
    return true;
  }
}
