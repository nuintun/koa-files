/**
 * @module utils
 * @license MIT
 * @author nuintun
 */

import fs, { Stats } from 'fs';
import { relative } from 'path';

const CHARS: string[] = Array.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');

/**
 * @function isOutRange
 * @description Test path is out of bound of base
 * @param {string} path
 * @param {string} root
 * @returns {boolean}
 */
export function isOutRange(path: string, root: string): boolean {
  path = relative(root, path);

  return /\.\.(?:[\\/]|$)/.test(path);
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
 * @function fstat
 * @param {string} path
 * @returns {Promise<Stats>}
 */
export function fstat(path: string): Promise<Stats> {
  type Resolve = (value: Stats) => void;
  type Reject = (reason: NodeJS.ErrnoException) => void;

  return new Promise((resolve: Resolve, reject: Reject): void => {
    fs.stat(path, (error: NodeJS.ErrnoException, stats: Stats): void => {
      error ? reject(error) : resolve(stats);
    });
  });
}

/**
 * @function hasTrailingSlash
 * @param {string} path
 * @returns {boolean}
 */
export function hasTrailingSlash(path: string): boolean {
  return /\/$/.test(path);
}
