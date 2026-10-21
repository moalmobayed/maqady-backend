import type { ImageKind, KindRule } from './types';

/** PRD "Media": photos up to 10 MB (design §9, §10.7). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Design §9: images above 40 megapixels are refused before they are decoded. */
export const MAX_INPUT_PIXELS = 40_000_000;

/** How far an upload's aspect ratio may be from its kind's and still be centre-cropped to fit. */
export const ASPECT_TOLERANCE = 0.02;

/**
 * The rules of each kind (`docs/gh-5-media/spec.md` "Kind rules"). Minimums apply to the
 * oriented upload after any crop. Variant sizes are upper bounds: a smaller upload gives smaller
 * variants, never upscaled ones.
 */
export const KIND_RULES: Readonly<Record<ImageKind, KindRule>> = {
  poster: {
    aspect: [2, 3],
    shape: 'refuse',
    minWidth: 400,
    minHeight: 600,
    variants: [
      { name: 'small', maxWidth: 200, maxHeight: 300 },
      { name: 'medium', maxWidth: 400, maxHeight: 600 },
      { name: 'large', maxWidth: 800, maxHeight: 1200 },
    ],
  },
  backdrop: {
    aspect: [16, 9],
    shape: 'crop',
    minWidth: 1280,
    minHeight: 720,
    variants: [
      { name: 'small', maxWidth: 640, maxHeight: 360 },
      { name: 'medium', maxWidth: 1280, maxHeight: 720 },
      { name: 'large', maxWidth: 1920, maxHeight: 1080 },
    ],
  },
  person: {
    aspect: [1, 1],
    shape: 'refuse',
    minWidth: 600,
    minHeight: 600,
    variants: [
      { name: 'small', maxWidth: 150, maxHeight: 150 },
      { name: 'medium', maxWidth: 300, maxHeight: 300 },
      { name: 'large', maxWidth: 600, maxHeight: 600 },
    ],
  },
  gallery: {
    aspect: null,
    shape: 'keep',
    minWidth: 320,
    minHeight: 320,
    variants: [
      { name: 'small', maxWidth: 480, maxHeight: 480 },
      { name: 'medium', maxWidth: 1024, maxHeight: 1024 },
      { name: 'large', maxWidth: 1920, maxHeight: 1920 },
    ],
  },
};

/** WebP output: good quality at web sizes, moderate CPU on a small instance. */
export const WEBP_OPTIONS = { quality: 80, effort: 4 } as const;

/** The multipart field that carries the file. */
export const UPLOAD_FILE_FIELD = 'file';

/**
 * Multer limits: exactly one file of at most 10 MB, and a few short text fields (a caption, a
 * photo type). Anything beyond is refused before it is buffered.
 */
export const MULTER_LIMITS = {
  fileSize: MAX_UPLOAD_BYTES,
  files: 1,
  fields: 20,
  fieldSize: 2048,
  parts: 21,
} as const;

/** Stored files never change (each image has its own prefix), so caches may keep them a year. */
export const STORAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const STORAGE_CACHE_MAX_AGE_SECONDS = 31_536_000;

/** How long one storage request may take before it counts as unavailable. */
export const STORAGE_TIMEOUT_MS = 15_000;

/** Supabase Storage removes at most this many paths per request. */
export const STORAGE_DELETE_BATCH = 1000;

/** Page size of Supabase Storage listings. */
export const STORAGE_LIST_PAGE = 1000;

/** Where the local driver's files are served, outside `/api/v1`. */
export const LOCAL_MEDIA_ROUTE = '/media';

/** One path segment of a storage path: lower-case letters, digits, `.`, `_` and `-`. */
export const STORAGE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** `<kind>/<uuid>`, as `chk_images_storage_prefix` requires. */
export const STORAGE_PREFIX_PATTERN = /^(poster|backdrop|person|gallery)\/[0-9a-f-]{36}$/;

/** An orphaned prefix younger than this may be an upload whose row is about to be written. */
export const ORPHAN_MIN_AGE_MINUTES = 60;

/** Prefixes looked up per query by `npm run media:orphans`. */
export const ORPHAN_LOOKUP_BATCH = 500;

/** A deadlock or serialization failure re-runs the upload's short transaction once (§7.1). */
export const MAX_UPLOAD_TRANSACTION_ATTEMPTS = 2;
