/**
 * @module fix-types
 */

import { isBuiltin } from 'node:module';
import { resolvePaths } from 'dts-paths';
import type { OnResolveFailed } from 'dts-paths';

const onResolveFailed: OnResolveFailed = ({ specifier, importer }) => {
  if (!isBuiltin(specifier)) {
    throw new Error(`failed to resolve '${specifier}' from '${importer}'`);
  }
};

Promise.all([
  resolvePaths('cjs', {
    tsconfig: {
      extends: './tsconfig.json',
      compilerOptions: {
        rootDir: 'cjs',
        paths: {
          '/*': ['./cjs/*']
        }
      }
    },
    mapExtension({ importer }) {
      return importer ? '.cjs' : '.cts';
    },
    onResolveFailed
  }),
  resolvePaths('esm', {
    tsconfig: {
      extends: './tsconfig.json',
      compilerOptions: {
        rootDir: 'esm',
        paths: {
          '/*': ['./esm/*']
        }
      }
    },
    onResolveFailed
  })
]).then(
  ([cjs, esm]) => {
    console.log(`fix cjs types: ${cjs.size} files`);
    console.log(`fix esm types: ${esm.size} files`);
  },
  error => {
    console.error(error);
  }
);
