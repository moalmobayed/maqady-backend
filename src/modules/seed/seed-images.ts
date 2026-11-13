import sharp from 'sharp';
import {
  SEED_IMAGE_ATTEMPTS,
  SEED_IMAGE_MAX_RETRY_WAIT_MS,
  SEED_IMAGE_RETRY_MS,
  SEED_IMAGE_TIMEOUT_MS,
  SEED_IMAGE_USER_AGENT,
} from './seed.constants';

/**
 * Placeholder pictures for the development seed, generated with sharp so no binary is committed:
 * a diagonal gradient from `colour` to a darker shade with a few soft circles placed from the
 * `seed` text, so every movie, person and theater gets its own recognisable picture. No text is
 * drawn, so nothing depends on the fonts installed. Each is a JPEG of the exact size asked for,
 * which then goes through the real image pipeline like any upload.
 */
export async function placeholderImage(
  width: number,
  height: number,
  colour: string,
  seed: string,
): Promise<Buffer> {
  const random = seededRandom(seed);
  const circles = Array.from({ length: 5 }, () => {
    const radius = Math.round((0.08 + random() * 0.22) * Math.min(width, height));
    const cx = Math.round(random() * width);
    const cy = Math.round(random() * height);
    const opacity = (0.08 + random() * 0.2).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#ffffff" fill-opacity="${opacity}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${colour}"/>
        <stop offset="1" stop-color="${darken(colour)}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    ${circles}
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

/**
 * A real picture for a dataset that names one: downloaded from `url`, turned upright, then
 * cropped to exactly `width` × `height` around its most salient part (faces, the title), as a
 * JPEG that then goes through the real image pipeline like any upload. A host that answers `429`
 * or `5xx` is asked again, up to `SEED_IMAGE_ATTEMPTS` times (#29: Wikimedia rate-limits bursts).
 * A failed download throws, naming the URL, so the seed stops rather than store a broken
 * picture; it can run again.
 */
export async function downloadedImage(
  url: string,
  width: number,
  height: number,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<Buffer> {
  let response = await download(url);
  for (let attempt = 1; attempt < SEED_IMAGE_ATTEMPTS && retryable(response.status); attempt++) {
    await wait(retryDelay(response, attempt));
    response = await download(url);
  }
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.startsWith('image/')) {
    throw new Error(`Seed: the picture ${url} answered ${response.status} ${type}`.trim());
  }
  const original = Buffer.from(await response.arrayBuffer());
  return sharp(original)
    .rotate()
    .resize(width, height, { fit: 'cover', position: sharp.strategy.attention })
    .jpeg({ quality: 88 })
    .toBuffer();
}

function download(url: string): Promise<Response> {
  return fetch(url, {
    headers: { 'User-Agent': SEED_IMAGE_USER_AGENT },
    signal: AbortSignal.timeout(SEED_IMAGE_TIMEOUT_MS),
  });
}

/** Too many requests, or a server error: worth asking again. */
function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** The longer of the response's `Retry-After` and a pause growing with each attempt, capped. */
function retryDelay(response: Response, attempt: number): number {
  const seconds = Number(response.headers.get('retry-after'));
  const asked = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  return Math.min(Math.max(asked, SEED_IMAGE_RETRY_MS * attempt), SEED_IMAGE_MAX_RETRY_WAIT_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A colour a third darker, for the far end of the gradient. */
function darken(colour: string): string {
  const value = Number.parseInt(colour.slice(1), 16);
  const channel = (shift: number): string =>
    Math.round(((value >> shift) & 0xff) * 0.35)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** A small deterministic generator (mulberry32) seeded from the text, so reruns draw the same. */
function seededRandom(text: string): () => number {
  let state = 0;
  for (const char of text) state = (Math.imul(state, 31) + char.charCodeAt(0)) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
