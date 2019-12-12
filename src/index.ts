/**
 * @module index
 * @license MIT
 * @author nuintun
 */

import { Context, Middleware, Next } from 'koa';
import Send, { Options, Ignore, DirCallback, ErrorCallback } from './Send';

/**
 * @function server
 * @param {string} root
 * @param {Options} options
 */
export default function server(root: string, options: Options): Middleware {
  return async (ctx: Context, next: Next): Promise<any> => {
    const { start }: Send = new Send(ctx, root, options);

    await next();

    await start();
  };
}

// Export types
export { Options, Ignore, DirCallback, ErrorCallback };
