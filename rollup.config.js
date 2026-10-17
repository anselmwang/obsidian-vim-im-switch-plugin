const typescript = require('@rollup/plugin-typescript');
const { readFileSync } = require('node:fs');
const isProd = process.env.BUILD === 'production';

module.exports = {
  input: 'main.ts',
  output: {
    file: 'main.js',
    sourcemap: !isProd,
    format: 'cjs',
    exports: 'default',
    banner: `/*
Vim Input Method Memory
Derived from yuanotes/obsidian-vim-im-switch-plugin (TypeScript 1.0.8).
Source: https://github.com/anselmwang/obsidian-vim-im-switch-plugin

${readFileSync('LICENSE', 'utf8')}
*/`,
  },
  external: ['obsidian', 'child_process', 'path'],
  plugins: [typescript()],
};
