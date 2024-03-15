/**
 * @module index
 * @license MIT
 * @author nuintun
 */

import { Context, Middleware, Next } from 'koa';
import Files, { Options as FilesOptions } from './Files';

export interface Options extends FilesOptions {
  defer?: boolean;
}

/**
 * @function server
 * @param {string} root
 * @param {Options} options
 */
export default function server(root: string, options?: Options): Middleware {
  const files = new Files(root, options);

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
