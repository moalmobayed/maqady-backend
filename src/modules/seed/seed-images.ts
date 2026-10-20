import sharp from 'sharp';

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
