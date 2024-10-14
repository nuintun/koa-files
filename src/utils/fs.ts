/**
 * @module fs
 */

import fs, { Stats } from 'fs';

export interface FileSystem {
  stat: typeof fs.stat;
  open: typeof fs.open;
  read: typeof fs.read;
  close: typeof fs.close;
}

/**
 * @function stat
 * @description Get file stats.
 * @param fs The file system to used.
 * @param path The file path.
 */
export function stat(fs: FileSystem, path: string): Promise<Stats | null> {
  return new Promise(resolve => {
    fs.stat(path, (error, stats) => {
      resolve(error ? null : stats);
    });
  });
}
