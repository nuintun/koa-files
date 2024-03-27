/**
 * @module index
 */

import fs from 'fs';
import { Middleware } from 'koa';
import { FileSystem } from './utils/fs';
import Service, { Options as ServiceOptions } from './Service';

export interface Options extends Omit<ServiceOptions, 'fs'> {
  fs?: FileSystem;
  defer?: boolean;
}

/**
 * @function server
 * @param {string} root
 * @param {Options} options
 */
export default function server(root: string, options?: Options): Middleware {
  const config = { fs, ...options };
  const service = new Service(root, config);

  if (config.defer) {
    return async (context, next) => {
      await next();
      await service.response(context);
    };
  }

  return async (context, next) => {
    if (!(await service.response(context))) {
      await next();
    }
  };
}
