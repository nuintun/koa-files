/**
 * @module index
 */

import { Middleware } from 'koa';
import Service, { Options as ServiceOptions } from './Service';

export interface Options extends ServiceOptions {
  defer?: boolean;
}

/**
 * @function server
 * @param {string} root
 * @param {Options} options
 */
export default function server(root: string, options?: Options): Middleware {
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
