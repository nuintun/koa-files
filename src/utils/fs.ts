/**
 * @module fs
 */

import { ReadStream, Stats } from 'fs';

type PathLike = string | Buffer | URL;

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

export interface FileSystem {
  stat(path: PathLike, callback: (error: Error | null, stats: Stats) => void): void;
  createReadStream(path: PathLike, options?: { start?: number; end?: number }): ReadStream;
}
