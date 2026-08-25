import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadLinearImages, extractLinearImageUrls } from "../src/images.ts";

test("extractLinearImageUrls", () => {
  const md = "x ![](https://uploads.linear.app/aaa/bbb) y";
  assert.deepEqual(extractLinearImageUrls(md), ["https://uploads.linear.app/aaa/bbb"]);
});

test("downloadLinearImages rewrites markdown to local files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "limg-"));
  const url = "https://uploads.linear.app/aaa/bbb.png";
  const { markdown, files } = await downloadLinearImages({
    markdown: `shot ${url}`,
    destDir: dir,
    token: "t",
    fetchImpl: async () =>
      new Response(Buffer.from("png"), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
  });
  assert.equal(files.length, 1);
  assert.equal(markdown.includes(url), false);
  assert.match(markdown, /\.linear-images|img-1|\.png/);
});
