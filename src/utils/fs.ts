/**
 * @module fs
 */

import { createReadStream, stat, Stats } from 'fs';

export interface FileSystem {
  readonly stat: typeof stat;
  readonly createReadStream: typeof createReadStream;
}

/**
 * @function fstat
 * @description Get file stats.
 * @param path The file path.
 */
export function fstat(fs: FileSystem, path: string): Promise<Stats> {
  return new Promise((resolve, reject): void => {
    fs.stat(path, (error, stats): void => {
      error ? reject(error) : resolve(stats);
    });
  });
}
