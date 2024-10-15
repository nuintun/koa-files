/**
 * @module stream
 */

import { PathLike } from 'fs';
import { Buffer } from 'buffer';
import { FileSystem } from './fs';
import { Readable, ReadableOptions } from 'stream';

const enum ReadState {
  PREFIX,
  RANGE,
  SUFFIX
}

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
  private readState: ReadState = ReadState.PREFIX;

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
  public _construct(callback: Callback): void {
    this.fs.open(this.path, 'r', (openError, fd) => {
      if (openError === null) {
        this.fd = fd;
      }

      callback(openError);
    });
  }

  private getRange(): Range | undefined {
    return this.ranges[this.currentRangeIndex];
  }

  private getPadding(range: Range): Buffer | undefined {
    switch (this.readState) {
      case ReadState.PREFIX:
        return range.prefix;
      case ReadState.SUFFIX:
        return range.suffix;
    }
  }

  private readPadding(fd: number, range: Range, size: number): void {
    let bytesRead = 0;

    const padding = this.getPadding(range);
    const hasRangePadding = padding != null;
    const length = hasRangePadding ? padding.length : 0;

    if (hasRangePadding && length > 0) {
      const begin = this.bytesRead;

      bytesRead = Math.min(size, length - begin);

      const end = begin + bytesRead;

      this.push(padding.subarray(begin, end));

      this.bytesRead = end;
    }

    if (!hasRangePadding || this.bytesRead >= length) {
      this.bytesRead = 0;

      const hasBytesRead = bytesRead > 0;

      switch (this.readState) {
        case ReadState.PREFIX:
          this.readState = ReadState.RANGE;

          if (!hasBytesRead) {
            this.readRange(fd, range, size);
          }
          break;
        case ReadState.SUFFIX:
          this.currentRangeIndex++;
          this.readState = ReadState.PREFIX;

          if (!hasBytesRead) {
            const range = this.getRange();

            if (range == null) {
              this.push(null);
            } else {
              this.readPadding(fd, range, size);
            }
          }
          break;
      }
    }
  }

  private readRange(fd: number, range: Range, size: number): void {
    this.reading = true;

    const { length } = range;
    const { bytesRead } = this;
    const position = range.offset + bytesRead;
    const buffer = Buffer.alloc(Math.min(size, length - bytesRead));

    this.fs.read(fd, buffer, 0, buffer.length, position, (readError, bytesRead, buffer) => {
      if (readError === null) {
        const hasBytesRead = bytesRead > 0;

        if (hasBytesRead) {
          this.push(buffer.subarray(0, bytesRead));

          this.bytesRead += bytesRead;
        }

        if (this.bytesRead >= length) {
          this.bytesRead = 0;
          this.readState = ReadState.SUFFIX;
        }

        if (!hasBytesRead) {
          this.readPadding(fd, range, size);
        }
      } else {
        this.destroy(readError);
      }

      this.reading = false;
    });
  }

  /**
   * @function _read
   * @param size The number of bytes to read.
   */
  public _read(size: number): void {
    if (!this.reading) {
      const { fd } = this;
      const range = this.getRange();

      if (fd != null && range != null) {
        switch (this.readState) {
          case ReadState.PREFIX:
          case ReadState.SUFFIX:
            this.readPadding(fd, range, size);
            break;
          case ReadState.RANGE:
            this.readRange(fd, range, size);
            break;
          default:
            throw new Error(`invalid read state: ${this.readState}`);
        }
      } else {
        this.push(null);
      }
    }
  }

  /**
   * @function _destroy
   * @param error The error.
   * @param callback The callback.
   */
  public _destroy(error: Error | null, callback: Callback): void {
    const { fd } = this;

    if (fd != null) {
      this.fs.close(fd, closeError => {
        callback(error ?? closeError);
      });
    } else {
      callback(error);
    }
  }
}
