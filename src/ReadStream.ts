/**
 * @module ReadStream
 */

import { PathLike } from 'fs';
import { Buffer } from 'buffer';
import { FileSystem } from './utils/fs';
import { Readable, ReadableOptions } from 'stream';

const enum ReadState {
  PREFIX,
  RANGE,
  SUFFIX
}

export interface Range {
  offset: number;
  length: number;
  prefix?: Buffer;
  suffix?: Buffer;
}

export interface Options
  extends Pick<
    ReadableOptions,
    // High water mark.
    'highWaterMark'
  > {
  fs: FileSystem;
}

interface Callback {
  (error?: Error | null): void;
}

const DISPOSE_EVENT = Symbol('dispose');

export class ReadStream extends Readable {
  private readonly fs: FileSystem;
  private readonly path: PathLike;
  private readonly ranges: Range[];

  private bytesRead: number = 0;
  private fd: number | null = null;
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
    const { fs, highWaterMark } = options;

    super({ highWaterMark });

    this.fs = fs;
    this.path = path;
    this.ranges = ranges;
  }

  /**
   * @override
   * @method _construct
   * @param callback The callback.
   */
  override _construct(callback: Callback): void {
    this.fs.open(this.path, 'r', (openError, fd) => {
      if (openError == null) {
        this.fd = fd;
      }

      callback(openError);
    });
  }

  /**
   * @private
   * @method getRange
   */
  private getRange(): Range | undefined {
    return this.ranges[this.currentRangeIndex];
  }

  /**
   * @private
   * @method getPadding
   * @param range The current range.
   */
  private getPadding(range: Range): Buffer | undefined {
    switch (this.readState) {
      case ReadState.PREFIX:
        return range.prefix;
      case ReadState.SUFFIX:
        return range.suffix;
    }
  }

  /**
   * @private
   * @method readFilePadding
   * @param fd The file descriptor.
   * @param range The current range.
   * @param size The number of bytes to read.
   */
  private readFilePadding(fd: number, range: Range, size: number): void {
    let bytesRead = 0;

    const padding = this.getPadding(range);
    const hasRangePadding = padding != null;

    // If padding exists.
    if (hasRangePadding) {
      const { length } = padding;
      const begin = this.bytesRead;

      if (length > 0 && begin < length) {
        bytesRead = Math.min(size, length - begin);

        const end = begin + bytesRead;

        this.push(padding.subarray(begin, end));

        this.bytesRead = end;
      }
    }

    // If no padding or read completed.
    if (bytesRead <= 0) {
      this.bytesRead = 0;

      const { readState } = this;

      // Change read state.
      switch (readState) {
        case ReadState.PREFIX:
          this.readState = ReadState.RANGE;

          this.readFileRange(fd, range, size);
          break;
        case ReadState.SUFFIX:
          this.currentRangeIndex++;
          this.readState = ReadState.PREFIX;

          const nextRange = this.getRange();

          if (nextRange == null) {
            this.push(null);
          } else {
            this.readFilePadding(fd, nextRange, size);
          }
          break;
      }
    }
  }

  /**
   * @private
   * @method readFileRange
   * @param fd The file descriptor.
   * @param range The current range.
   * @param size The number of bytes to read.
   */
  private readFileRange(fd: number, range: Range, size: number): void {
    this.reading = true;

    const { bytesRead } = this;
    const position = range.offset + bytesRead;
    const buffer = Buffer.allocUnsafeSlow(Math.min(size, range.length - bytesRead));

    // Read file range.
    this.fs.read(fd, buffer, 0, buffer.length, position, (readError, bytesRead, buffer) => {
      this.reading = false;

      // Tell ._destroy() that it's safe to close the fd now.
      if (this.destroyed) {
        this.emit(DISPOSE_EVENT, readError);
      } else {
        if (readError != null) {
          this.destroy(readError);
        } else {
          if (bytesRead > 0) {
            if (bytesRead !== buffer.length) {
              // Slow path. Shrink to fit.
              // Copy instead of slice so that we don't retain
              // large backing buffer for small reads.
              const chunk = Buffer.allocUnsafeSlow(bytesRead);

              buffer.copy(chunk, 0, 0, bytesRead);

              buffer = chunk;
            }

            this.push(buffer);

            this.bytesRead += bytesRead;
          } else {
            this.bytesRead = 0;
            this.readState = ReadState.SUFFIX;

            this.readFilePadding(fd, range, size);
          }
        }
      }
    });
  }

  /**
   * @override
   * @method _read
   * @param size The number of bytes to read.
   */
  override _read(size: number): void {
    if (!this.reading) {
      const { fd } = this;
      const range = this.getRange();

      // If fd or range is null, finish stream.
      if (fd == null || range == null) {
        this.push(null);
      } else {
        const { readState } = this;

        // Read bytes from range.
        switch (readState) {
          case ReadState.PREFIX:
          case ReadState.SUFFIX:
            this.readFilePadding(fd, range, size);
            break;
          case ReadState.RANGE:
            this.readFileRange(fd, range, size);
            break;
        }
      }
    }
  }

  /**
   * @private
   * @method dispose
   * @param error The error.
   * @param callback The callback.
   */
  private dispose(error: Error | null, callback: Callback): void {
    const { fd } = this;

    if (fd != null) {
      this.fd = null;

      // Close the fd.
      this.fs.close(fd, closeError => {
        callback(error ?? closeError);
      });
    } else {
      callback(error);
    }
  }

  /**
   * @override
   * @method _destroy
   * @param error The error.
   * @param callback The callback.
   */
  override _destroy(error: Error | null, callback: Callback): void {
    // Wait I/O completion.
    if (this.reading) {
      this.once(DISPOSE_EVENT, disposeError => {
        this.dispose(error ?? disposeError, callback);
      });
    } else {
      this.dispose(error, callback);
    }
  }
}
