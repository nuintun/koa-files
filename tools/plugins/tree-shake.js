/**
 * @module treeShake
 */

import MagicString from 'magic-string';

/***
 * @function treeShake
 * @description Fixed tree shaking for typescript and rollup preserve modules
 * @see https://github.com/GiG/rollup-plugin-rename-extensions
 */
export default function treeShake() {
  return {
    name: 'rollup-plugin-tree-shake',
    generateBundle(options, bundle) {
      const files = Object.entries(bundle);

      for (const [, file] of files) {
        if (!file.isAsset) {
          const code = new MagicString(file.code);

          this.parse(file.code, {
            sourceType: 'module',
            onComment(block, text, start, end) {
              if (block && text === '* @class ') {
                code.overwrite(start, end, '/*#__PURE__*/');
              }
            }
          });

          if (options.sourcemap) {
            file.map = code.generateMap();
          }

          file.code = code.toString();
        }
      }
    }
  };
}
