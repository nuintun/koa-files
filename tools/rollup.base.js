/**
 * @module rollup.base
 */

import treeShake from './plugins/tree-shake';
import typescript from '@rollup/plugin-typescript';

/**
 * @function rollup
 * @param esnext
 * @param development
 */
export default function rollup(esnext) {
  return {
    input: 'src/index.ts',
    preserveModules: true,
    output: {
      interop: false,
      exports: 'auto',
      esModule: false,
      dir: esnext ? 'esm' : 'cjs',
      format: esnext ? 'esm' : 'cjs'
    },
    plugins: [typescript(), treeShake()],
    onwarn(error, warn) {
      if (error.code !== 'CIRCULAR_DEPENDENCY') {
        warn(error);
      }
    },
    external: ['fs', 'path', 'etag', 'tslib', 'stream', 'destroy', 'range-parser']
  };
}
