/**
 * @module stream
 */

import { PathLike } from 'fs';
import { Buffer } from 'buffer';
import { FileSystem } from './fs';
import { Readable, ReadableOptions } from 'stream';

export interface Options
  extends Pick<
    ReadableOptions,
    // Encoding.
    | 'encoding'
    // High water mark.
    | 'highWaterMark'
  > {
  fs: FileSystem;
}

export interface Range {
  offset: number;
  length: number;
  prefix?: Buffer;
  suffix?: Buffer;
}

interface Callback {
  (error?: Error | null): void;
}

export class FileReadStream extends Readable {
  private fd?: number;
  private fs: FileSystem;
  private path: PathLike;
  private ranges: Range[];

  private bytesRead: number = 0;
  private reading: boolean = false;
  private currentRangeIndex: number = 0;

  /**
   * @constructor
   * @param path The file path.
   * @param ranges The ranges to read.
   * @param options The stream options.
   */
  constructor(path: PathLike, ranges: Range[], options: Options) {
    const { fs, encoding, highWaterMark } = options;

    super({ encoding, highWaterMark });

    this.fs = fs;
    this.path = path;
    this.ranges = ranges;
  }

  /**
   * @function _construct
   * @param callback The callback.
   */
  _construct(callback: Callback): void {
    this.fs.open(this.path, 'r', (openError, fd) => {
      // Open success.
      if (openError === null) {
        this.fd = fd;
      }

      // Call callback.
      callback(openError);
    });
  }

  /**
   * @function _read
   * @param size The number of bytes to read.
   */
  _read(size: number): void {
    if (!this.reading) {
      this.reading = true;

      // Get the current range.
      const range = this.ranges[this.currentRangeIndex];

      // Check range and file fd.
      if (range && this.fd != null) {
        const { length } = range;
        const { bytesRead } = this;
        const position = range.offset + bytesRead;
        const buffer = Buffer.alloc(Math.min(size, length - bytesRead));

        // Read range data.
        this.fs.read(this.fd, buffer, 0, buffer.length, position, (readError, bytesRead, buffer) => {
          // Set the reading flag to false.
          this.reading = false;

          // Read success.
          if (readError === null) {
            const buffers: Buffer[] = [];

            // Range start.
            if (this.bytesRead === 0) {
              // Write range prefix.
              if (range.prefix != null) {
                buffers.push(range.prefix);
              }
            }

            // Update bytes read.
            this.bytesRead += bytesRead;

            // Has bytes read.
            const hasBytesRead = bytesRead > 0;

            // Push the read data to the stream.
            if (hasBytesRead || length === 0) {
              buffers.push(buffer.subarray(0, bytesRead));
            }

            // Range end.
            if (!hasBytesRead || this.bytesRead >= range.length) {
              // Current range is fully read, move to the next range.
              this.bytesRead = 0;
              this.currentRangeIndex++;

              // Write range suffix.
              if (range.suffix != null) {
                buffers.push(range.suffix);
              }
            }

            // Push the buffers to the stream.
            this.push(Buffer.concat(buffers));
          } else {
            this.destroy(readError);
          }
        });
      } else {
        // Set the reading flag to false.
        this.reading = false;

        // All ranges are read.
        this.push(null);
      }
    }
  }

  /**
   * @function _destroy
   * @param error The error.
   * @param callback The callback.
   */
  _destroy(error: Error | null, callback: Callback): void {
    if (this.fd != null) {
      this.fs.close(this.fd, closeError => {
        callback(error ?? closeError);
      });
    } else {
      callback(error);
    }
  }
}
