/**
 * @module clean
 */

import { rimraf } from 'rimraf';

rimraf.sync(['cjs', 'esm', 'types']);
