/**
 * @module fs
 */

import { PathLike, Stats } from 'node:fs';

type TBuffer = NodeJS.ArrayBufferView;

type Exception = NodeJS.ErrnoException;

interface CloseCallback {
  (error: Exception | null): void;
}

interface OpenCallback {
  (error: Exception | null, fd: number): void;
}

interface StatCallback {
  (error: Exception | null, stats: Stats): void;
}

interface ReadCallback<T extends TBuffer> {
  (error: Exception | null, bytesRead: number, buffer: T): void;
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
  stat(path: PathLike, callback: StatCallback): void;
  open(path: PathLike, flags: string, callback: OpenCallback): void;
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
