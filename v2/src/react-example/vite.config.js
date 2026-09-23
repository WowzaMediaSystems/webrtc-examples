import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The example ships as a set of static files that may be served from a sub-path,
// so every asset URL is emitted relative to index.html.
export default defineConfig({
  base: './',
  plugins: [react()],

  /*
   * CRA emitted to build/ and the wowza.com deploy that publishes these pages copies that
   * folder (/_private/webrtc/react-example/ and the /developer/webrtc/dev-* paths), so the
   * name is a contract with the deploy job, not Vite's choice to make. Move to the dist/
   * default only together with whoever owns that job.
   */
  build: { outDir: 'build' },

  css: {
    preprocessorOptions: {
      scss: {
        /*
         * Bootstrap's own files are full of Sass that Dart Sass now warns about: the global
         * colour functions, the old if(), the @import rules between its partials. That is
         * Bootstrap's code and Bootstrap's to change, which is what quietDeps is for.
         */
        quietDeps: true,

        /*
         * One entry, and only because Bootstrap 5.3 cannot be consumed any other way.
         *
         * @use was tried and does not work partial by partial: bootstrap/scss/_variables.scss
         * calls the _assert-ascending mixin from _functions.scss, and under @use it cannot see
         * it, so the build fails with "Undefined mixin". @use works only for the whole bundle,
         * which is 9 KB more gzipped CSS than the partials this example actually uses, and at
         * that point the Sass step buys nothing over the prebuilt stylesheet.
         *
         * So src/styles/bootstrap.scss has to use @import, and this stops it saying so twenty
         * times a build. It is not covered by quietDeps above because that file is ours, not a
         * dependency.
         *
         * @import is removed in Dart Sass 3.0. This has to be resolved before then, by
         * Bootstrap shipping a module build or by us going back to its prebuilt CSS.
         *
         * Nothing else belongs in this list. It held four more entries that were never needed:
         * three that quietDeps already covered, and mixed-decls, which Dart Sass has since
         * retired, so naming it produced a warning of its own about silencing something that
         * no longer exists.
         */
        silenceDeprecations: ['import'],
      },
    },
  },

  server: {
    port: 3000,
    open: true,
  },
  preview: {
    port: 3000,
  },

  test: {
    globals: true,
    // e2e/ is Playwright's; Vitest must not try to run those specs.
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    css: true,
  },
});
