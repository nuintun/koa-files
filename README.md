# koa-files

<!-- prettier-ignore -->
> A static files serving middleware for koa.
>
> [![NPM Version][npm-image]][npm-url]
> [![Download Status][download-image]][npm-url]
> [![Languages Status][languages-image]][github-url]
> ![Node Version][node-image]
> [![License][license-image]][license-url]

## Installation

```bash
$ npm install koa-files
```

## API

```ts
import { Middleware } from 'koa';
import fs, { Stats } from 'node:fs';

interface Headers {
  [key: string]: string | string[];
}

interface IgnoreFunction {
  (path: string): boolean | Promise<boolean>;
}

interface HeadersFunction {
  (path: string, stats: Stats): Promise<Headers | void> | Headers | void;
}

export interface FileSystem {
  stat: typeof fs.stat;
  open: typeof fs.open;
  read: typeof fs.read;
  close: typeof fs.close;
}

export interface Options {
  fs?: FileSystem;
  defer?: boolean;
  etag?: boolean;
  acceptRanges?: boolean;
  lastModified?: boolean;
  highWaterMark?: number;
  ignore?: IgnoreFunction;
  headers?: Headers | HeadersFunction;
}

export function server(root: string, options?: Options): Middleware;
```

### root

- Root directory string.
- Nothing above this root directory can be served.

### Options

##### `fs`

- Defaults to `node:fs`.
- The file system to used.

##### `defer`

- Defaults to `false`.
- If true, serves after `await next()`.
- Allowing any downstream middleware to respond first.

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

##### `ignore`

- Defaults to `undefined`.
- Function that determines if a file should be ignored.

##### `headers`

- Defaults to `undefined`.
- Set headers to be sent.
- See docs: [Headers in MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers).

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

## Features

Support multipart range and download resumption.

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
