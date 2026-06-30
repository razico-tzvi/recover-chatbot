import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const serve = process.argv.includes("--serve");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  target: ["es2019"],
  outfile: "dist/widget.js",
  minify: !watch,
  sourcemap: watch,
  legalComments: "none",
};

if (watch || serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  if (serve) {
    const { host, port } = await ctx.serve({ servedir: ".", port: 8080 });
    console.log(`Widget dev server: http://${host}:${port}/demo.html`);
  } else {
    console.log("Watching widget…");
  }
} else {
  await esbuild.build(options);
  console.log("Built dist/widget.js");
}
