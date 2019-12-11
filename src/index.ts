/**
 * @module index
 * @license MIT
 * @author nuintun
 */

// import ms from 'ms';
// import etag from 'etag';
import { Context, Next, Middleware } from 'koa';

type Ondir = (path: string) => string;
type Onerror = (error: Error) => string;
type Ignore = false | ((path: string) => false | 'deny' | 'ignore');

export interface Options {
  ondir: Ondir;
  etag: boolean;
  ignore: Ignore;
  charset: string;
  onerror: Onerror;
  immutable: boolean;
  acceptRanges: boolean;
  cacheControl: boolean;
  lastModified: boolean;
  maxAge: string | number;
  defaultDocument: string | string[] | boolean;
}

class Send {
  constructor(ctx: Context, root: string, options: Options) {

  }
}

export default function server(root: string, options: Options): Middleware {
  return async (ctx: Context, next: Next): Promise<Send> => new Send(ctx, root, options);
}
