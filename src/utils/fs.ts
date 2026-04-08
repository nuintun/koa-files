/**
 * @module fs
 */

import { Stats } from 'node:fs';
import { Buffer } from 'node:buffer';

interface Callback<T extends unknown[] = []> {
  (error: Error | null, ...rest: T): void;
}

export interface FileSystem {
  close(fd: number, callback: Callback): void;
  read<T extends Buffer<ArrayBuffer>>(
    fd: number,
    buffer: T,
    offset: number,
    length: number,
    position: number,
    callback: Callback<[bytesRead: number, buffer: T]>
  ): void;
  stat(path: string, callback: Callback<[stats: Stats]>): void;
  open(path: string, flags: string, callback: Callback<[fd: number]>): void;
}

/**
 * @function stat
 * @description Get file stats.
 * @param fs The file system to use.
 * @param path The file path.
 */
export function stat(fs: FileSystem, path: string): Promise<Stats | null> {
  return new Promise(resolve => {
    fs.stat(path, (error, stats) => {
      resolve(error != null ? null : stats);
    });
  });
}
