import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildSiteArtifact, PUBLIC_ROOT_FILES } from "./lib/site-artifact.mjs";

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tech-topics-artifact-"));
  async function put(file, text = "fixture") {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  try {
    for (const file of PUBLIC_ROOT_FILES) await put(file, "");
    await put("index.html", '<link href="styles.css?v=1"><script src="app.js"></script><a href="article.html?slug=post">Article</a>');
    await put("app.js", 'fetch("content/articles/index.json");');
    await put("sw.js", 'importScripts("./sw-version.js");');
    await put("sw-version.js", 'const PRECACHE_FILES = ["index.html", "assets/post/cover.jpg"];');
    await put("styles.css", '@import "assets/theme.css";');
    await put("assets/theme.css", 'body { background: url("post/plot.jpg"); }');
    await put("assets/post/cover.jpg");
    await put("assets/post/plot.jpg");
    await put("assets/post/experiment.py", "print('downloadable')");
    await put("assets/maskable.png");
    await put("manifest.webmanifest", JSON.stringify({ start_url: "./index.html", icons: [{ src: "assets/maskable.png" }] }));
    await put("content/articles/index.json", JSON.stringify([{ slug: "post", path: "content/articles/post.json" }]));
    await put("content/articles/post.json", JSON.stringify({ image: "assets/post/cover.jpg", bodyHtml: '<img src="assets/post/plot.jpg" srcset="assets/post/cover.jpg 1x, assets/post/plot.jpg 2x"><a href="assets/post/experiment.py" download>Download</a><a href="https://example.com/external">External</a>' }));
    for (const file of ["README.md", "AGENTS.md", "docs/private.md", "generation/registry.json", "scripts/private.mjs", "tools/voice.wav", "content/tts-lexicon.json", ".git/config"]) await put(file, "private tooling");
    await run({ root, put });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("publishes all runtime and article assets, preserving URLs independently of precache", async () => fixture(async ({ root }) => {
  const built = await buildSiteArtifact({ root });
  assert.equal(built.destination, path.join(root, "dist"));
  for (const file of [...PUBLIC_ROOT_FILES, "content/articles/index.json", "content/articles/post.json", "assets/post/plot.jpg", "assets/post/experiment.py", "assets/maskable.png"]) {
    assert(built.files.includes(file), file);
    assert.equal(await readFile(path.join(root, "dist", file), "utf8"), await readFile(path.join(root, file), "utf8"));
  }
  assert(!built.files.some(file => /^(docs|generation|scripts|tools|\.git)\//.test(file)));
  assert(!built.files.includes("content/tts-lexicon.json"));
  const entries = await readdir(path.join(root, "dist"));
  assert(!entries.includes("README.md"));
  assert(!entries.includes("AGENTS.md"));
  const manifest = JSON.parse(await readFile(path.join(root, "dist", ".site-artifact.json"), "utf8"));
  assert.deepEqual(manifest.files, built.files);
}));

test("rebuild removes obsolete public assets and leaves source/tooling untouched", async () => fixture(async ({ root, put }) => {
  await put("assets/obsolete.jpg");
  await buildSiteArtifact({ root });
  await rm(path.join(root, "assets/obsolete.jpg"));
  const rebuilt = await buildSiteArtifact({ root });
  assert(!rebuilt.files.includes("assets/obsolete.jpg"));
  await assert.rejects(readFile(path.join(root, "dist/assets/obsolete.jpg")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(root, "tools/voice.wav"), "utf8"), "private tooling");
}));

test("fails on missing local HTML, CSS, JS, article, manifest and precache references", async () => {
  const cases = [
    ["index.html", '<img src="assets/missing.jpg">'],
    ["styles.css", 'body { background: url("assets/missing.jpg"); }'],
    ["app.js", 'import "./missing.js";'],
    ["article.js", 'fetch("content/articles/missing.json");'],
    ["content/articles/post.json", JSON.stringify({ image: "assets/missing.jpg", bodyHtml: "" })],
    ["content/articles/post.json", JSON.stringify({ image: "assets/post/cover.jpg", bodyHtml: '<a href="assets/missing.py">Download</a>' })],
    ["content/articles/index.json", JSON.stringify([{ path: "content/articles/missing.json" }])],
    ["manifest.webmanifest", JSON.stringify({ icons: [{ src: "assets/missing.png" }] })],
    ["sw-version.js", 'const PRECACHE_FILES = ["assets/missing.jpg"];']
  ];
  for (const [file, text] of cases) await fixture(async ({ root, put }) => {
    await buildSiteArtifact({ root });
    const previous = await readFile(path.join(root, "dist", "index.html"), "utf8");
    await put(file, text);
    await assert.rejects(buildSiteArtifact({ root }), /missing public reference/);
    assert.equal(await readFile(path.join(root, "dist", "index.html"), "utf8"), previous);
  });
});

test("rejects traversal and root-absolute URLs rather than escaping the Pages base", async () => {
  for (const value of ["../private.md", "%2e%2e/private.md", "/assets/post/cover.jpg", "assets%5cpost%5ccover.jpg"]) await fixture(async ({ root, put }) => {
    await put("index.html", `<img src="${value}">`);
    await assert.rejects(buildSiteArtifact({ root }), /Unsafe artifact path|Repository-relative URL required/);
  });
});

test("refuses arbitrary output directories and unmanaged dist contents", async () => fixture(async ({ root, put }) => {
  for (const destination of [".", "tools", "../outside", path.join(os.tmpdir(), "other-artifact")]) {
    await assert.rejects(buildSiteArtifact({ root, destination }), /destination must be/);
  }
  await put("dist/precious.txt", "keep");
  await assert.rejects(buildSiteArtifact({ root }), /unmanaged dist/);
  assert.equal(await readFile(path.join(root, "dist/precious.txt"), "utf8"), "keep");
}));

test("refuses unmanaged additions and unsafe manifests in an existing artifact", async () => fixture(async ({ root, put }) => {
  await buildSiteArtifact({ root });
  await put("dist/precious.txt", "keep");
  await assert.rejects(buildSiteArtifact({ root }), /unmanaged files/);
  await put("dist/.site-artifact.json", JSON.stringify({ version: 1, files: ["../tools/voice.wav"] }));
  await assert.rejects(buildSiteArtifact({ root }), /Unsafe artifact path/);
  assert.equal(await readFile(path.join(root, "dist/precious.txt"), "utf8"), "keep");
}));

test("rejects source and destination directory symlinks", async context => {
  await fixture(async ({ root }) => {
    try { await symlink(path.join(root, "tools"), path.join(root, "assets/linked"), "junction"); }
    catch (error) {
      if (["EPERM", "ENOTSUP", "EACCES"].includes(error.code)) { context.skip(`Symlinks unavailable: ${error.code}`); return; }
      throw error;
    }
    await assert.rejects(buildSiteArtifact({ root }), /Symbolic links/);
    await rm(path.join(root, "assets/linked"));
    await symlink(path.join(root, "tools"), path.join(root, "dist"), "junction");
    await assert.rejects(buildSiteArtifact({ root }), /dist must be a regular directory/);
    assert.equal(await readFile(path.join(root, "tools/voice.wav"), "utf8"), "private tooling");
  });
});
