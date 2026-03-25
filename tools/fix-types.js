/**
 * @module fix-types
 */

import { resolvePaths } from 'dts-paths';

Promise.all([
  resolvePaths('cjs', {
    mapExtension({ importer }) {
      return importer ? '.cjs' : '.cts';
    }
  }),
  resolvePaths('esm')
]).then(
  ([esm, cjs]) => {
    console.log(`fix cjs types: ${cjs.size} files`);
    console.log(`fix esm types: ${esm.size} files`);
  },
  error => {
    console.error(error);
  }
);
