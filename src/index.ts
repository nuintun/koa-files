/**
 * @module index
 */

import fs from 'fs';
import { FileSystem } from './utils/fs';
import { Context, Middleware, Next } from 'koa';
import Files, { Options as FilesOptions } from './Files';

export interface Options extends Omit<FilesOptions, 'fs'> {
  fs?: FileSystem;
  defer?: boolean;
}

/**
 * @function server
 * @param {string} root
 * @param {Options} options
 */
export default function server(root: string, options: Options = {}): Middleware {
  options.fs = options.fs ?? fs;

  const files = new Files(root, options as FilesOptions);

  if (options && options.defer) {
    return async (context: Context, next: Next): Promise<void> => {
      await next();
      await files.response(context);
    };
  }

  return async (context: Context, next: Next): Promise<void> => {
    if (!(await files.response(context))) {
      await next();
    }
  };
}
