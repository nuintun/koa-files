/**
 * @module rollup.base
 */

import { createRequire } from 'module';
import treeShake from './plugins/tree-shake.js';
import typescript from '@rollup/plugin-typescript';

const pkg = createRequire(import.meta.url)('../package.json');

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
    output: {
      banner,
      esModule: false,
      exports: 'auto',
      interop: 'auto',
      preserveModules: true,
      dir: esnext ? 'esm' : 'cjs',
      format: esnext ? 'esm' : 'cjs',
      generatedCode: { constBindings: true },
      entryFileNames: `[name].${esnext ? 'js' : 'cjs'}`,
      chunkFileNames: `[name].${esnext ? 'js' : 'cjs'}`
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
