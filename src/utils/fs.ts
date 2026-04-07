/**
 * @module fs
 */

import { Stats } from 'node:fs';

type TBuffer = NodeJS.ArrayBufferView;

interface CloseCallback {
  (error: Error | null): void;
}

interface OpenCallback {
  (error: Error | null, fd: number): void;
}

interface StatCallback {
  (error: Error | null, stats: Stats): void;
}

interface ReadCallback<T extends TBuffer> {
  (error: Error | null, bytesRead: number, buffer: T): void;
}

export interface FileSystem {
  read<T extends TBuffer>(
    fd: number,
    buffer: T,
    offset: number,
    length: number,
    position: number,
    callback: ReadCallback<T>
  ): void;
  close(fd: number, callback: CloseCallback): void;
  stat(path: string, callback: StatCallback): void;
  open(path: string, flags: string, callback: OpenCallback): void;
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
