/**
 * @module index
 */

import { Middleware } from 'koa';
import { Options as ServiceOptions, Service } from './Service';

export interface Options extends ServiceOptions {
  defer?: boolean;
}

/**
 * @function server
 * @description Create files server.
 * @param {string} root The files server root.
 * @param {Options} options The files server options.
 */
export function server(root: string, options?: Options): Middleware {
  const service = new Service(root, options);

  if (options?.defer) {
    return async (context, next) => {
      await next();
      await service.respond(context);
    };
  }

  return async (context, next) => {
    if (!(await service.respond(context))) {
      await next();
    }
  };
}
