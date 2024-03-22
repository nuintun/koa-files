/**
 * @module index
 */

import fs from 'fs';
import { Middleware } from 'koa';
import { FileSystem } from './utils/fs';
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
  options.fs = options.fs || fs;

  const files = new Files(root, options as FilesOptions);

  if (options && options.defer) {
    return async (context, next) => {
      await next();
      await files.response(context);
    };
  }

  return async (context, next) => {
    if (!(await files.response(context))) {
      await next();
    }
  };
}
