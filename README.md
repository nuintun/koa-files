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
import Koa from 'koa';
import files from 'koa-files';

const app = new Koa();

// Static files server
app.use(files(root, options));
```

- `root` root directory string. nothing above this root directory can be served.
- `options` options object.

### Options

#### fs?: `{ readonly stat: typeof fs.stat, readonly createReadStream: typeof createReadStream }`

- The fs module to use, defaults to use `fs` of node.

#### headers?: `{ [key: string]: string | string[] } | (path: string, stats: fs.Stats): { [key: string]: string | string[] } | void>`

- Set headers to be sent, defaults to `undefined`, see docs: [Headers in MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers).

#### acceptRanges?: `boolean`

- Enable or disable accepting ranged requests, disabling this will not send Accept-Ranges and ignore the contents of the Range request header, defaults to `true`.

#### etag?: `boolean`

- Enable or disable etag generation, defaults to `true`.

#### lastModified?: `boolean`

- Enable or disable Last-Modified header, defaults to true. Uses the file system's last modified value. defaults to `true`.

#### ignore?: `(path: string) => boolean`

- Set ignore rules. defaults to `undefined`.

#### defer?: `boolean`

- If true, serves after `await next()`, allowing any downstream middleware to respond first. defaults to `false`.

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
