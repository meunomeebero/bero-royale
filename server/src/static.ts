import { Elysia } from "elysia";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import {
  brotliCompressSync,
  gzipSync,
  constants as zlibConstants,
} from "node:zlib";

/**
 * Node-adapter-safe static file server for the built Vite SPA. Serves files
 * from `root`, with an `index.html` fallback for client-side routes (so deep
 * links like `/play` work on refresh). Returns a web-standard Response so it
 * works identically under @elysiajs/node. Registered LAST so it never shadows
 * the API routes.
 */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".obj": "text/plain; charset=utf-8",
  ".mtl": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

function contentType(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Extensions worth compressing: text-shaped, highly compressible assets. Already
 * compressed binaries (png/jpg/jpeg/gif/webp/ico/woff/woff2/wasm) are NOT listed —
 * recompressing them wastes CPU and can grow the payload.
 */
const COMPRESSIBLE = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".map",
  ".svg",
  ".obj",
  ".mtl",
  ".txt",
  ".ttf",
  ".otf",
]);

/** Smallest payload worth compressing (tiny files don't benefit + add overhead). */
const MIN_COMPRESS_BYTES = 1024;

type Encoding = "br" | "gzip";

/**
 * Compress-on-first-read cache, keyed by `<file>|<encoding>`. The SPA assets are
 * content-hashed + immutable and the process restarts on every redeploy, so the
 * cached bytes can never go stale within a process lifetime.
 */
const compressedCache = new Map<string, Uint8Array>();

/**
 * Pick the best supported encoding the client advertised, or null for identity.
 * Prefers brotli (smaller) over gzip. Only a presence check — we don't honor
 * q-values (a deliberate simplification; every real browser sends `br, gzip`).
 */
function negotiateEncoding(accept: string | null): Encoding | null {
  if (!accept) return null;
  const a = accept.toLowerCase();
  if (a.includes("br")) return "br";
  if (a.includes("gzip")) return "gzip";
  return null;
}

/** Compress `data` with `enc`, memoizing the result by file path + encoding. */
function compress(file: string, enc: Encoding, data: Buffer): Uint8Array {
  const key = `${file}|${enc}`;
  const hit = compressedCache.get(key);
  if (hit) return hit;
  const out =
    enc === "br"
      ? new Uint8Array(
          brotliCompressSync(data, {
            params: {
              [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
              [zlibConstants.BROTLI_PARAM_SIZE_HINT]: data.length,
            },
          }),
        )
      : new Uint8Array(gzipSync(data, { level: 6 }));
  compressedCache.set(key, out);
  return out;
}

async function readIfFile(path: string): Promise<Buffer | null> {
  try {
    const s = await stat(path);
    if (s.isDirectory()) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

export function spaStatic(root: string) {
  const base = resolve(root);
  const indexPath = join(base, "index.html");

  const serve = async (
    pathname: string,
    acceptEncoding: string | null,
  ): Promise<Response> => {
    // A malformed percent-escape throws — return 400 rather than crashing to 500.
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    // Resolve the request path under `base` and reject traversal escapes.
    let rel = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^[/\\]+/, "");
    if (rel === "" || rel.endsWith("/")) rel = join(rel, "index.html");
    const target = resolve(base, rel);
    if (target !== base && !target.startsWith(base + sep)) {
      return new Response("Forbidden", { status: 403 });
    }

    let data = await readIfFile(target);
    let file = target;
    if (!data) {
      // SPA fallback: extension-less routes (e.g. /play) get index.html.
      if (extname(rel) === "") {
        data = await readIfFile(indexPath);
        file = indexPath;
      }
    }
    if (!data) return new Response("Not found", { status: 404 });

    const ext = extname(file).toLowerCase();
    const isHtml = ext === ".html";

    const headers: Record<string, string> = {
      "content-type": contentType(file),
      "cache-control": isHtml
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    };

    // Negotiated compression for text-shaped assets. The body bytes for a given
    // encoding are byte-identical to the uncompressed file after the client
    // decodes them, so asset correctness is preserved; `Vary` keeps shared caches
    // from serving the wrong encoding to a client that didn't ask for it.
    let body: Uint8Array = new Uint8Array(data);
    if (COMPRESSIBLE.has(ext) && data.length >= MIN_COMPRESS_BYTES) {
      headers["vary"] = "Accept-Encoding";
      const enc = negotiateEncoding(acceptEncoding);
      if (enc) {
        body = compress(file, enc, data);
        headers["content-encoding"] = enc;
      }
    }

    return new Response(body, { status: 200, headers });
  };

  const acceptEncodingOf = (request: Request): string | null =>
    request.headers.get("accept-encoding");

  return new Elysia({ name: "spa-static" })
    .get("/", ({ request }) =>
      serve(new URL(request.url).pathname, acceptEncodingOf(request)),
    )
    .get("/*", ({ request }) =>
      serve(new URL(request.url).pathname, acceptEncodingOf(request)),
    );
}
