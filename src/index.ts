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
export default function server(root: string, options: Options = {}): Middleware {
  if (options.defer) {
    return async (ctx: Context, next: Next): Promise<void> => {
      await next();
      await new Send(ctx, root, options).response();
    };
  }

  return async (ctx: Context, next: Next): Promise<void> => {
    const respond: boolean = await new Send(ctx, root, options).response();

    !respond && (await next());
  };
}
