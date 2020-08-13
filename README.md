# koa-files

> A static files serving middleware for koa.
>
> [![NPM Version][npm-image]][npm-url]
> [![Download Status][download-image]][npm-url]
> [![Snyk Vulnerabilities][snyk-image]][snyk-url]
> ![Node Version][node-image]
> [![Dependencies][david-image]][david-url]

## Installation

```bash
$ npm install koa-files
```

## API

```js
const Koa = require('koa');
const server = require('koa-files');

const app = new Koa();

// Static files server
app.use(server(root, options));
```

- `root` root directory string. nothing above this root directory can be served.
- `options` options object.

### Options

#### acceptRanges: `boolean`

- Enable or disable accepting ranged requests. Disabling this will not send Accept-Ranges and ignore the contents of the Range request header. defaults to `true`.

#### cacheControl: `false | string`

- Set Cache-Control response header, defaults to `public, max-age=31557600`, see docs: [Cache-Control in MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control).

#### etag: `boolean`

- Enable or disable etag generation, defaults to `true`.

#### ignore: `false | (path: string) => boolean`

- Set ignore rules. defaults to `false`.

#### lastModified: `boolean`

- Enable or disable Last-Modified header, defaults to true. Uses the file system's last modified value. defaults to `true`.

#### defer: `boolean`

- If true, serves after `await next()`, allowing any downstream middleware to respond first. defaults to `false`.

## Example

```js
/**
 * @module server
 * @license MIT
 * @author nuintun
 */

'use strict';

const Koa = require('koa');
const server = require('koa-files');

const app = new Koa();
const port = process.env.PORT || 80;

/**
 * @function httpError
 * @param {NodeJS.ErrnoException} error
 * @returns {boolean}
 */
function httpError(error) {
  return /^(EOF|EPIPE|ECANCELED|ECONNRESET|ECONNABORTED)$/i.test(error.code);
}

// Static files server
app.use(server('tests'));

// Listen error event
app.on('error', error => !httpError(error) && console.error(error));

// Start server
app.listen(port, () => console.log(`> server running at: 127.0.0.1:${port}`));
```

## Features

Support multipart range and download resumption.

## License

MIT

[npm-image]: https://img.shields.io/npm/v/koa-files.svg?style=flat-square
[npm-url]: https://www.npmjs.org/package/koa-files
[download-image]: https://img.shields.io/npm/dm/koa-files.svg?style=flat-square
[snyk-image]: https://img.shields.io/snyk/vulnerabilities/github/nuintun/koa-files.svg?style=flat-square
[snyk-url]: https://snyk.io/test/github/nuintun/koa-files
[node-image]: https://img.shields.io/node/v/koa-files.svg?style=flat-square
[david-image]: https://img.shields.io/david/nuintun/koa-files.svg?style=flat-square
[david-url]: https://david-dm.org/nuintun/koa-files
