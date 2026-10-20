import {
  MAX_YOUTUBE_URL_LENGTH,
  YOUTUBE_EMBED_BASE,
  YOUTUBE_HOSTS,
  YOUTUBE_ID_PATTERN,
  YOUTUBE_THUMBNAIL_BASE,
  YOUTUBE_WATCH_BASE,
} from './catalog.constants';

/**
 * YouTube links (design §9, PRD "Media"): the API accepts watch, youtu.be, shorts and embed URLs
 * and stores only the 11-character video id; every URL it answers is derived from that id, so
 * no YouTube API key is needed.
 */

/**
 * The video id of a YouTube link, or null when the input isn't one. Accepted, after trimming:
 *
 * - `http(s)://[www.|m.]youtube.com/watch?v=<id>` (also `music.youtube.com`), any other query
 *   parameters ignored;
 * - `http(s)://[www.|m.]youtube.com/shorts/<id>` and `/embed/<id>`;
 * - `http(s)://youtu.be/<id>`;
 * - `http(s)://[www.]youtube-nocookie.com/embed/<id>`.
 *
 * The host must be one of those exactly (so `youtube.com.evil.example` is refused), with no user
 * name, password or port, and the id exactly 11 of `A–Z a–z 0–9 _ -`. A bare id is refused: the
 * admin pastes a link.
 */
export function parseYoutubeUrl(input: string): string | null {
  const text = input.trim();
  if (text.length === 0 || text.length > MAX_YOUTUBE_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '' || url.port !== '') return null;
  const rule = YOUTUBE_HOSTS[url.hostname];
  if (!rule) return null;

  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  let id: string | null = null;
  if (rule.watch && segments.length === 1 && segments[0] === 'watch') {
    id = url.searchParams.get('v');
  } else if (rule.shorts && segments.length === 2 && segments[0] === 'shorts') {
    id = segments[1] ?? null;
  } else if (rule.embed && segments.length === 2 && segments[0] === 'embed') {
    id = segments[1] ?? null;
  } else if (rule.shortLink && segments.length === 1) {
    id = segments[0] ?? null;
  }
  return id !== null && YOUTUBE_ID_PATTERN.test(id) ? id : null;
}

/** The privacy-enhanced embed URL of a video. */
export function youtubeEmbedUrl(youtubeId: string): string {
  return `${YOUTUBE_EMBED_BASE}${youtubeId}`;
}

/** The video's high-quality thumbnail. */
export function youtubeThumbnailUrl(youtubeId: string): string {
  return `${YOUTUBE_THUMBNAIL_BASE}${youtubeId}/hqdefault.jpg`;
}

/** The video on YouTube itself, for the admin's "open on YouTube" link. */
export function youtubeWatchUrl(youtubeId: string): string {
  return `${YOUTUBE_WATCH_BASE}${youtubeId}`;
}
