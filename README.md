# koa-files

<!-- prettier-ignore -->
> A static files serving middleware for koa.
>
> [![NPM Version][npm-image]][npm-url]
> [![Download Status][download-image]][npm-url]
> [![Languages Status][languages-image]][github-url]
> ![Node Version][node-image]

## Installation

```bash
$ npm install koa-files
```

## API

```ts
import { Middleware } from 'koa';
import { createReadStream, stat, Stats } from 'fs';

interface IgnoreFunction {
  (path: string): boolean;
}

interface Headers {
  [key: string]: string | string[];
}

interface HeaderFunction {
  (path: string, stats: Stats): Headers | void;
}

interface FileSystem {
  readonly stat: typeof stat;
  readonly createReadStream: typeof createReadStream;
}

export interface Options {
  etag?: boolean;
  fs?: FileSystem;
  defer?: boolean;
  acceptRanges?: boolean;
  lastModified?: boolean;
  ignore?: IgnoreFunction;
  headers?: Headers | HeaderFunction;
}

export default function server(root: string, options?: Options): Middleware;
```

### root

> Root directory string.
> Nothing above this root directory can be served.

### Options

##### `fs`

> The fs module to use.
> Defaults to `node:fs`.

##### `headers`

> Set headers to be sent.
> See docs: [Headers in MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers).
> Defaults to `undefined`.

##### `acceptRanges`

> Enable or disable accepting ranged requests.
> Disabling this will not send Accept-Ranges and ignore the contents of the Range request header.
> Can be overridden by the `headers`.
> Defaults to `true`.

##### `etag`

> Enable or disable etag generation.
> Use weak etag internally.
> Can be overridden by the `headers`.
> Defaults to `true`.

##### `lastModified`

> Enable or disable Last-Modified header.
> Uses the file system's last modified value.
> Can be overridden by the `headers`.
> Defaults to `true`.

##### `ignore`

> Set ignore rules.
> Defaults to `undefined`.

##### `defer`

> If true, serves after `await next()`,
> allowing any downstream middleware to respond first.
> Defaults to `false`.

## Example

```ts
/**
 * @module server
 * @license MIT
 * @author nuintun
 */

import Koa from 'koa';
import files from 'koa-files';

const app = new Koa();
const port = process.env.PORT || 80;

// Static files server
app.use(
  files('tests', {
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
