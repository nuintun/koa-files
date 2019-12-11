/**
 * @module through
 * @license MIT
 * @author nuintun
 */

import { Transform, TransformOptions, TransformCallback } from 'stream';

export type TransformFunction = (chunk: any, encoding: string, callback: TransformCallback) => void;
export type FlushFunction = (callback: TransformCallback) => void;

/**
 * @function noop
 * @description A noop _transform function
 * @param {any} chunk
 * @param {string} encoding
 * @param {Function} next
 */
function noop(chunk: any, encoding: string, next: TransformCallback): void {
  next(null, chunk);
}

/**
 * @function through
 * @param {TransformOptions | TransformFunction} options
 * @param {ransformFunction | FlushFunction} transform
 * @param {FlushFunction} flush
 * @returns {Transform}
 */
export default function through(
  options: TransformOptions | TransformFunction,
  transform: TransformFunction | FlushFunction,
  flush: FlushFunction
): Transform {
  if (typeof options === 'function') {
    transform = options as TransformFunction;
    flush = transform as FlushFunction;
    options = {} as TransformOptions;
  } else if (typeof transform !== 'function') {
    transform = noop;
  }

  options = options || {};

  if (options.objectMode == null) options.objectMode = true;

  if (options.highWaterMark == null) options.highWaterMark = 16;

  const stream = new Transform(options);

  stream._transform = transform;

  if (typeof flush === 'function') stream._flush = flush;

  return stream;
}
