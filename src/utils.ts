import { relative } from 'path';

const toString: () => string = Object.prototype.toString;
const CHARS: string[] = Array.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');

/**
 * @function typeOf
 * @description The data type judgment
 * @param {any} value
 * @param {string} type
 * @returns {boolean}
 */
export function typeOf(value: any, type: string): boolean {
  // Format type
  type = String(type).toLowerCase();

  // Switch
  switch (type) {
    case 'nan':
      return Number.isNaN(value);
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'function':
      return typeof value === 'function';
    case 'undefined':
      return value === undefined;
    default:
      // Get real type
      const realType = toString.call(value).toLowerCase();

      // Is other
      return realType === '[object ' + type + ']';
  }
}

/**
 * @function isOutBound
 * @description Test path is out of bound of base
 * @param {string} path
 * @param {string} root
 * @returns {boolean}
 */
export function isOutBound(path: string, root: string): boolean {
  path = relative(root, path);

  if (/\.\.(?:[\\/]|$)/.test(path)) return true;

  return false;
}

/**
 * @function unixify
 * @description Convert path separators to posix/unix-style forward slashes
 * @param {string} path
 * @returns {string}
 */
export function unixify(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * @function normalize
 * @description Normalize path
 * @param {string} path
 * @returns {string}
 */
export function normalize(path: string): string {
  // \a\b\.\c\.\d ==> /a/b/./c/./d
  path = unixify(path);

  // :///a/b/c ==> ://a/b/c
  path = path.replace(/:\/{3,}/, '://');

  // /a/b/./c/./d ==> /a/b/c/d
  path = path.replace(/\/\.\//g, '/');

  // a//b/c ==> a/b/c
  // //a/b/c ==> /a/b/c
  // a///b/////c ==> a/b/c
  path = path.replace(/(^|[^:])\/{2,}/g, '$1/');

  // Transfer path
  let src: string = path;
  // DOUBLE_DOT_RE matches a/b/c//../d path correctly only if replace // with / first
  const DOUBLE_DOT_RE: RegExp = /([^/]+)\/\.\.(?:\/|$)/g;

  // a/b/c/../../d ==> a/b/../d ==> a/d
  do {
    src = src.replace(DOUBLE_DOT_RE, (matched: string, dirname: string) => {
      return dirname === '..' ? matched : '';
    });

    // Break
    if (path === src) {
      break;
    } else {
      path = src;
    }
  } while (true);

  // Get path
  return path;
}

/**
 * @function decodeURI
 * @description Decode URI component.
 * @param {string} URI
 * @returns {string|-1}
 */
export function decodeURI(URI: string): string | -1 {
  try {
    return decodeURIComponent(URI);
  } catch (error) {
    return -1;
  }
}

/**
 * @function boundaryGenerator
 * @description Create boundary
 * @returns {string}
 */
export function boundaryGenerator(): string {
  let boundary: string = '';

  // Create boundary
  for (let i: number = 0; i < 38; i++) {
    boundary += CHARS[Math.floor(Math.random() * 62)];
  }

  // Return boundary
  return boundary;
}

/**
 * @function parseHttpDate
 * @description Parse an HTTP Date into a number.
 * @param {string} date
 * @returns {number}
 * @private
 */
export function parseHttpDate(date: string): number {
  const timestamp = date && Date.parse(date);

  return typeOf(timestamp, 'number') ? timestamp : NaN;
}

/**
 * @function Faster apply
 * @description Call is faster than apply, optimize less than 6 args
 * @param  {() => any} fn
 * @param  {any} context
 * @param  {any[]} args
 * @see https://github.com/micro-js/apply
 * @see http://blog.csdn.net/zhengyinhui100/article/details/7837127
 */
export function apply(fn: () => any, context: any, args: any[]): any {
  switch (args.length) {
    // Faster
    case 0:
      return fn.call(context);
    case 1:
      return fn.call(context, args[0]);
    case 2:
      return fn.call(context, args[0], args[1]);
    case 3:
      return fn.call(context, args[0], args[1], args[2]);
    default:
      // Slower
      return fn.apply(context, args);
  }
}

/**
 * @function parseTokens
 * @description Parse a HTTP tokens.
 * @param {string[]} value
 */
export function parseTokens(value: string): string[] {
  let start: number = 0;
  let end: number = 0;
  let tokens: string[] = [];

  // gather tokens
  for (let i: number = 0, length: number = value.length; i < length; i++) {
    switch (value.charCodeAt(i)) {
      case 0x20:
        // ' '
        if (start === end) {
          start = end = i + 1;
        }
        break;
      case 0x2c:
        // ','
        tokens.push(value.substring(start, end));
        start = end = i + 1;
        break;
      default:
        end = i + 1;
        break;
    }
  }

  // final token
  tokens.push(value.substring(start, end));

  return tokens;
}

/**
 * @function createErrorDocument
 * @param {number} statusCode
 * @param {string} statusMessage
 * @returns {string}
 */
export function createErrorDocument(statusCode: number, statusMessage: string): string {
  return (
    '<!DOCTYPE html>\n' +
    '<html>\n' +
    '  <head>\n' +
    '    <meta name="renderer" content="webkit" />\n' +
    '    <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1" />\n' +
    '    <meta content="text/html; charset=utf-8" http-equiv="content-type" />\n' +
    `    <title>${statusCode}</title>\n` +
    '    <style>\n' +
    '      html, body, div, p {\n' +
    '        text-align: center;\n' +
    '        margin: 0; padding: 0;\n' +
    '        font-family: Calibri, "Lucida Console", Consolas, "Liberation Mono", Menlo, Courier, monospace;\n' +
    '      }\n' +
    '      body { padding-top: 88px; }\n' +
    '      p { color: #0e90d2; line-height: 100%; }\n' +
    '      .status { font-size: 200px; font-weight: bold; }\n' +
    '      .message { font-size: 80px; }\n' +
    '    </style>\n' +
    '  </head>\n' +
    '  <body>\n' +
    `    <p class="status">${statusCode}</p>\n` +
    `    <p class="message">${statusMessage}</p>\n` +
    '  </body>\n' +
    '</html>\n'
  );
}
