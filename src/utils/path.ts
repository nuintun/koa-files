/**
 * @module path
 */

import { isAbsolute, relative } from 'path';

/**
 * @function unixify
 * @description Convert path to unix style.
 * @param path The path to convert.
 */
export function unixify(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * @function hasTrailingSlash
 * @description Check if path has trailing slash.
 * @param path The path to check.
 */
export function hasTrailingSlash(path: string): boolean {
  return /\/$/.test(path);
}

/**
 * @function isOutRoot
 * @description Check if path is out of root.
 * @param path The path to check.
 * @param root The root path.
 */
export function isOutRoot(path: string, root: string): boolean {
  path = relative(root, path);

  return /\.\.(?:[\\/]|$)/.test(path) || isAbsolute(path);
}
