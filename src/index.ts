/**
 * @module index
 * @license MIT
 * @author nuintun
 */

import { Context, Middleware, Next } from 'koa';
import Send, { Options as SendOptions } from './Send';

export interface Options extends SendOptions {
  defer?: boolean;
}

/**
 * @function server
 * @param {string} root
 * @param {Options} options
 */
export default function server(root: string, options?: Options): Middleware {
  const send = new Send(root, options);

  if (options && options.defer) {
    return async (context: Context, next: Next): Promise<void> => {
      await next();
      await send.response(context);
    };
  }

  return async (context: Context, next: Next): Promise<void> => {
    if (!(await send.response(context))) {
      await next();
    }
  };
}
