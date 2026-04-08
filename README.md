# koa-files

<!-- prettier-ignore -->
> A static files serving middleware for koa.
>
> [![NPM Version][npm-image]][npm-url]
> [![Download Status][download-image]][npm-url]
> [![Languages Status][languages-image]][github-url]
> ![Node Version][node-image]
> [![License][license-image]][license-url]

## Install

```bash
$ npm install koa-files
```

## Quick start

```ts
import Koa from 'koa';
import { server } from 'koa-files';

const app = new Koa();

app.use(
  server('public', {
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  })
);

app.listen(3000);
```

Then visit `http://127.0.0.1:3000/app.js` to serve `public/app.js`.

## API

```ts
import { Middleware } from 'koa';
import { PathLike, Stats } from 'node:fs';

interface Headers {
  [key: string]: string | string[];
}

interface IgnoreFunction {
  (path: string): Promise<boolean> | boolean;
}

interface HighWaterMarkFunction {
  (path: string, stats: Stats): Promise<number> | number;
}

interface HeadersFunction {
  (path: string, stats: Stats): Promise<Headers | void> | Headers | void;
}

export interface FileSystem {
  close(fd: number, callback?: (error?: Error | null) => void): void;
  read<T extends ArrayBufferView>(
    fd: number,
    buffer: T,
    offset: number,
    length: number,
    position: number | bigint | null,
    callback: (error: Error | null | undefined, bytesRead: number, buffer: T) => void
  ): void;
  stat(path: PathLike, callback: (error: Error | null | undefined, stats: Stats) => void): void;
  open(
    path: PathLike,
    flags: string | number | undefined,
    callback: (error: Error | null | undefined, fd: number) => void
  ): void;
}

export interface Options {
  etag?: boolean;
  defer?: boolean;
  fs?: FileSystem;
  acceptRanges?: boolean;
  lastModified?: boolean;
  ignore?: IgnoreFunction;
  headers?: Headers | HeadersFunction;
  highWaterMark?: number | HighWaterMarkFunction;
}

export function server(root: string, options?: Options): Middleware;
```

### root

- Root directory string.
- Nothing above this root directory can be served.
- `root` is resolved with `path.resolve`, so relative paths are based on the process working directory.

### Options

##### `fs`

- Defaults to `node:fs`.
- The file system to use.

##### `defer`

- Defaults to `false`.
- If true, serves after `await next()`.
- Allowing any downstream middleware to respond first.
- Useful when you want route handlers to take priority over static files.

##### `etag`

- Defaults to `true`.
- Enable or disable etag generation.
- Use weak etag internally.
- Can be overridden by the `headers`.

##### `acceptRanges`

- Defaults to `true`.
- Enable or disable accepting ranged requests.
- Disabling this will not send Accept-Ranges and ignore the contents of the Range request header.
- Can be overridden by the `headers`.

##### `lastModified`

- Defaults to `true`.
- Enable or disable Last-Modified header.
- Use the file system's last modified value.
- Can be overridden by the `headers`.

##### `highWaterMark`

- Defaults to `65536` (64 KiB).
- Set the high water mark for the read stream.
- Supports function form to customize by file path and stats.

##### `ignore`

- Defaults to `undefined`.
- Function that determines if a file should be ignored.
- Return `true` to skip static serving for the current file.

##### `headers`

- Defaults to `undefined`.
- Set headers to be sent.
- See docs: [Headers in MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers).
- Supports function form to compute headers dynamically.

### Behavior notes

- Only `GET` and `HEAD` requests are handled.
- `Range` requests are supported (including multipart range responses).
- Conditional requests are supported via `ETag` and `Last-Modified`.
- Requests containing invalid paths (e.g. null bytes) respond with `400`.
- Files outside `root` are never served.

## Example

```ts
/**
 * @module server
 * @license MIT
 * @author nuintun
 */

import Koa from 'koa';
import { server } from 'koa-files';

const app = new Koa();
const port = process.env.PORT || 80;

// Static files server
app.use(
  server('tests', {
    headers: {
      'Cache-Control': 'public, max-age=31557600'
    }
  })
);

/**
 * @function httpError
 * @param {NodeJS.ErrnoException} error
 * @returns {boolean}
 */
function httpError(error) {
  return /^(EOF|EPIPE|ECANCELED|ECONNRESET|ECONNABORTED)$/i.test(error.code);
}

// Listen error event
app.on('error', error => {
  !httpError(error) && console.error(error);
});

// Start server
app.listen(port, () => {
  console.log(`> server running at: 127.0.0.1:${port}`);
});
```

## More examples

### Prefer application routes first (`defer: true`)

```ts
app.use(async (ctx, next) => {
  if (ctx.path === '/healthz') {
    ctx.body = 'ok';
    return;
  }

  await next();
});

app.use(server('public', { defer: true }));
```

### Dynamic ignore rule

```ts
app.use(
  server('public', {
    ignore: path => path.endsWith('.map')
  })
);
```

### Dynamic stream buffer

```ts
app.use(
  server('public', {
    highWaterMark: (path, stats) => (stats.size > 10 * 1024 * 1024 ? 256 * 1024 : 64 * 1024)
  })
);
```

## Features

- Static file middleware for Koa.
- Supports multipart range and download resumption.
- Supports conditional requests (`ETag`, `Last-Modified`).

## License

MIT

[npm-image]: https://img.shields.io/npm/v/koa-files.svg?style=flat-square
[npm-url]: https://www.npmjs.org/package/koa-files
[download-image]: https://img.shields.io/npm/dm/koa-files.svg?style=flat-square
[languages-image]: https://img.shields.io/github/languages/top/nuintun/koa-files?style=flat-square
[github-url]: https://github.com/nuintun/koa-files
[node-image]: https://img.shields.io/node/v/koa-files.svg?style=flat-square
[license-image]: https://img.shields.io/github/license/nuintun/koa-files?style=flat-square
[license-url]: https://github.com/nuintun/koa-files/blob/main/LICENSE
