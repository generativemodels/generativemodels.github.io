// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { typst } from 'astro-typst';
import rehypeToc from '@jsdevtools/rehype-toc';
import rehypeSlug from 'rehype-slug';

// https://astro.build/config
export default defineConfig({
  site: 'https://generativemodels.github.io/',
  //base: '/',
  integrations: [
    mdx(),
    sitemap(),
    typst({
      options: {
        remPx: 14,
      },
      target: (id) => {
        console.debug(`Detecting ${id}`);
        if (id.endsWith(".html.typ") || id.includes("/html/")) return "html";
        return "svg";
      },
      // === <img src="xxx.svg"> instead of inlined <svg> ===
      emitSvg: true,
      // emitSvgDir: ".astro/typst"
      // === Add non-system fonts here ===
      // fontArgs: [
      //   { fontPaths: ['/system/fonts', '/user/fonts'] },
      //   { fontBlobs: [customFontBuffer] }
      // ],
    }),
  ],
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [
      [
        rehypeKatex,
        {
          macros: {},
          trust: true,
          strict: false,
        },
      ],
      rehypeSlug,
      rehypeToc,
    ],
  },
  vite: { ssr: { external: ["@myriaddreamin/typst-ts-node-compiler"] } },
});
