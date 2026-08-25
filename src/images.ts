import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const IMAGE_RE = /https:\/\/uploads\.linear\.app\/[^\s)"']+/g;

export function extractLinearImageUrls(markdown: string): string[] {
  return [...new Set(markdown.match(IMAGE_RE) ?? [])];
}

export async function downloadLinearImages(opts: {
  markdown: string;
  destDir: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<{ markdown: string; files: string[] }> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const urls = extractLinearImageUrls(opts.markdown);
  if (urls.length === 0) {
    return { markdown: opts.markdown, files: [] };
  }
  await mkdir(opts.destDir, { recursive: true });
  let markdown = opts.markdown;
  const files: string[] = [];
  let i = 0;
  for (const url of urls) {
    i += 1;
    const res = await fetchFn(url, {
      headers: { authorization: `Bearer ${opts.token}` },
    });
    if (!res.ok) continue;
    const ctype = res.headers.get("content-type") ?? "";
    const ext =
      extname(new URL(url).pathname).replace(/[^a-z0-9.]/gi, "") ||
      (ctype.includes("png") ? ".png" : ctype.includes("jpeg") || ctype.includes("jpg") ? ".jpg" : ".bin");
    const name = `img-${i}${ext.startsWith(".") ? ext : `.${ext}`}`;
    const dest = join(opts.destDir, name);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    files.push(dest);
    markdown = markdown.split(url).join(dest);
  }
  return { markdown, files };
}
