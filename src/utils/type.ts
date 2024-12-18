/**
 * @module type
 */

/**
 * @function isFunction
 * @description Check if value is function.
 * @param value The value to check.
 */
export function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}
