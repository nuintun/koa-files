/**
 * @module rollup.base
 */

import pkg from '../package.json';
import treeShake from './plugins/tree-shake';
import typescript from '@rollup/plugin-typescript';

const banner = `/**
 * @package ${pkg.name}
 * @license ${pkg.license}
 * @version ${pkg.version}
 * @author ${pkg.author.name} <${pkg.author.email}>
 * @description ${pkg.description}
 * @see ${pkg.homepage}
 */
`;

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
      banner,
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
