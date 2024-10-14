/**
 * @module stream
 */

import { PathLike } from 'fs';
import { Buffer } from 'buffer';
import { FileSystem } from './fs';
import { Readable, ReadableOptions } from 'stream';

export interface Range {
  offset: number;
  length: number;
  prefix?: Buffer;
  suffix?: Buffer;
}

interface Callback {
  (error?: Error | null): void;
}

export interface Options extends Pick<ReadableOptions, 'encoding' | 'highWaterMark'> {
  fs: FileSystem;
}

export class FileReadStream extends Readable {
  private fd?: number;
  private fs: FileSystem;
  private path: PathLike;
  private ranges: Range[];

  private bytesRead: number = 0;
  private reading: boolean = false;
  private currentRangeIndex: number = 0;

  constructor(path: PathLike, ranges: Range[], options: Options) {
    const { fs, encoding, highWaterMark } = options;

    super({ encoding, highWaterMark });

    this.fs = fs;
    this.path = path;
    this.ranges = ranges;
  }

  _construct(callback: Callback): void {
    this.fs.open(this.path, 'r', (error, fd) => {
      if (error === null) {
        this.fd = fd;
      }

      callback(error);
    });
  }

  _read(size: number): void {
    if (!this.reading) {
      this.reading = true;

      const range = this.ranges[this.currentRangeIndex];

      if (range && this.fd != null) {
        const position = range.offset + this.bytesRead;
        const buffer = Buffer.alloc(Math.min(size, range.length - this.bytesRead));

        this.fs.read(this.fd, buffer, 0, buffer.length, position, (error, bytesRead, buffer) => {
          if (error === null) {
            // Range start.
            if (this.bytesRead === 0) {
              if (range.prefix != null) {
                // Write range prefix.
                this.push(range.prefix);
              }
            }

            const hasBytesRead = bytesRead > 0;

            // Range data.
            if (hasBytesRead) {
              // Push the read data to the stream.
              if (bytesRead === buffer.length) {
                this.push(buffer);
              } else {
                this.push(buffer.subarray(0, bytesRead));
              }

              this.bytesRead += bytesRead;
            }

            // Range end.
            if (!hasBytesRead || this.bytesRead >= range.length) {
              // Current range is fully read, move to the next range.
              this.bytesRead = 0;
              this.currentRangeIndex++;

              if (range.suffix != null) {
                // Write range suffix.
                this.push(range.suffix);
              }
            }

            // Set the reading flag to false.
            this.reading = false;

            // Non bytes read, read the next range.
            if (!hasBytesRead) {
              this._read(size);
            }
          } else {
            // Set the reading flag to false.
            this.reading = false;

            // Destroy stream.
            this.destroy(error);
          }
        });
      } else {
        // All ranges are read.
        this.push(null);

        // Set the reading flag to false.
        this.reading = false;
      }
    }
  }

  _destroy(error: Error | null, callback: Callback): void {
    if (this.fd != null) {
      this.fs.close(this.fd, error => {
        callback(error);
      });
    } else {
      callback(error);
    }
  }
}
