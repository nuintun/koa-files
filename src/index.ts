/**
 * @module index
 * @license MIT
 * @author nuintun
 */

import { Context, Middleware, Next } from 'koa';
import Send, { Ignore, Options as SendOptions } from './Send';

interface Options extends SendOptions {
  defer?: boolean;
}

/**
 * @function server
 * @param {string} root
 * @param {Options} options
 */
export default function server(root: string, options: Options = {}): Middleware {
  if (options.defer) {
    return async (ctx: Context, next: Next): Promise<void> => {
      await next();
      await new Send(ctx, root, options).start();
    };
  }

  return async (ctx: Context, next: Next): Promise<void> => {
    const matched: boolean = await new Send(ctx, root, options).start();

    !matched && (await next());
  };
}

// Export types
export { Options, Ignore };
