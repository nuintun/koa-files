/**
 * @module hash
 */

import { getRandomValues } from 'node:crypto';

// prettier-ignore
const CHARS: string[] = [
  // 0-9
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  // A-M
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  // N-Z
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  // a-m
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  // n-z
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'
];

/**
 * @function generate
 * @description Generate a hash.
 * @param length The length of hash.
 */
export function generate(length: number): string {
  let hash = '';

  const randomValues = getRandomValues(new Uint8Array(length));

  // Create hash.
  for (const value of randomValues) {
    hash += CHARS[value % 62];
  }

  // Return hash.
  return hash;
}
