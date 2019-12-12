/**
 * @module rollup
 * @license MIT
 * @version 2018/03/28
 */

'use strict';

const del = require('del');
const rollup = require('rollup');
const pkg = require('./package.json');
const typescript = require('rollup-plugin-typescript2');

/**
 * @function build
 * @param {Object} inputOptions
 * @param {Object} outputOptions
 */
async function build(inputOptions, outputOptions) {
  del.sync(['typings', 'index.js'], { force: true });

  const bundle = await rollup.rollup(inputOptions);

  await bundle.write(outputOptions);

  console.log(`Build ${outputOptions.file} success!`);
}

const banner = `/**
 * @module ${pkg.name}
 * @license ${pkg.license}
 * @version ${pkg.version}
 * @author ${pkg.author.name}
 * @description ${pkg.description}
 * @see ${pkg.homepage}
 */
`;

const tsconfigOverride = { compilerOptions: { declaration: true, declarationDir: 'typings' } };

const inputOptions = {
  input: 'src/index.ts',
  external: ['tslib', 'ms', 'etag', 'destroy', 'range-parser', 'fs', 'path', 'stream'],
  plugins: [typescript({ tsconfigOverride, clean: true, useTsconfigDeclarationDir: true })]
};

const outputOptions = {
  banner,
  indent: true,
  strict: true,
  format: 'cjs',
  interop: false,
  file: 'index.js',
  preferConst: true
};

build(inputOptions, outputOptions);
