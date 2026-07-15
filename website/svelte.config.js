import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';

/** @type {import('mdsvex').MdsvexOptions} */
const mdsvexOptions = {
    extensions: ['.mdx'],
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
    extensions: ['.svelte', ...mdsvexOptions.extensions],
    preprocess: [vitePreprocess({ script: true }), mdsvex(mdsvexOptions)],
    kit: {
        adapter: adapter({
            pages: 'build',
            assets: 'build',
            fallback: 'index.html',
            precompress: false,
            strict: false,
        }),
        paths: {
            base: process.argv.includes('dev') ? '' : process.env.BASE_PATH,
            relative: false,
        },
        prerender: {
            crawl: true,
        },
    },
};

export default config;
