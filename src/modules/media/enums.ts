/**
 * What an image is for (design §9). The owner of the upload route picks the kind; each has fixed
 * rules (`KIND_RULES`). Mirrored by `chk_images_kind`.
 *
 * - `poster`: a movie poster, 2:3.
 * - `backdrop`: a wide cover, 16:9 (the theater cover).
 * - `person`: a person photo, square, at least 600 × 600 (PRD "Media").
 * - `gallery`: a photo that keeps its own shape (movie photos, theater gallery).
 */
export const IMAGE_KINDS = ['poster', 'backdrop', 'person', 'gallery'] as const;

/** The web sizes every image is stored in, smallest first (home-page contract `ImageVariant`). */
export const IMAGE_VARIANT_NAMES = ['small', 'medium', 'large'] as const;

/** The file types an upload may be, recognised by their first bytes (PRD: JPG or PNG). */
export const DETECTED_IMAGE_TYPES = ['jpeg', 'png'] as const;

/**
 * What the pipeline does with an upload whose aspect ratio is not the kind's:
 *
 * - `refuse`: within the tolerance, centre-crop to the exact ratio; beyond it, `IMAGE_WRONG_SHAPE`.
 * - `crop`: always centre-crop to the ratio.
 * - `keep`: the kind has no ratio; the picture keeps its own.
 */
export const SHAPE_POLICIES = ['refuse', 'crop', 'keep'] as const;
