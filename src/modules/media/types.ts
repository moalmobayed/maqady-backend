import type { Type } from '@nestjs/common';
import type { StaffPrincipal } from '../../common/auth/types';
import type {
  DETECTED_IMAGE_TYPES,
  IMAGE_KINDS,
  IMAGE_VARIANT_NAMES,
  SHAPE_POLICIES,
} from './enums';

export type ImageKind = (typeof IMAGE_KINDS)[number];

export type ImageVariantName = (typeof IMAGE_VARIANT_NAMES)[number];

export type DetectedImageType = (typeof DETECTED_IMAGE_TYPES)[number];

export type ShapePolicy = (typeof SHAPE_POLICIES)[number];

// --- Kind rules and the pipeline ------------------------------------------------------------

/** The largest box a variant fits in; the variant is never larger than its source. */
export interface VariantSpec {
  readonly name: ImageVariantName;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

/** The fixed rules of one image kind (design §9). */
export interface KindRule {
  /** Width and height of the target ratio, for example `[2, 3]`; null when the kind has none. */
  readonly aspect: readonly [number, number] | null;
  readonly shape: ShapePolicy;
  /** The smallest accepted size, measured after orientation and any crop. */
  readonly minWidth: number;
  readonly minHeight: number;
  /** Smallest first. */
  readonly variants: readonly VariantSpec[];
}

/** A rectangle of the EXIF-oriented upload, in pixels. */
export interface CropRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** One WebP variant the pipeline produced, not yet stored. */
export interface ProcessedVariant {
  readonly name: ImageVariantName;
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

/** What the pipeline made of one upload. */
export interface ProcessedImage {
  readonly kind: ImageKind;
  /** The size of the upload after EXIF orientation, before any crop. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Smallest first. */
  readonly variants: readonly ProcessedVariant[];
}

// --- Stored images --------------------------------------------------------------------------

/** One stored variant file, as `images.variants` records it. */
export interface StoredVariant {
  /** The storage path, for example `poster/<uuid>/small.webp`. */
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

export type StoredImageVariants = Readonly<Record<ImageVariantName, StoredVariant>>;

/** An `images` row, as other modules receive it from `MediaService`. */
export interface StoredImage {
  readonly id: number;
  readonly kind: ImageKind;
  /** `<kind>/<uuid>`: every variant of this image lives under it. */
  readonly storagePrefix: string;
  readonly variants: StoredImageVariants;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly createdByStaffId: number;
  readonly createdAt: Date;
}

/** An `images` row as the repository reads it. */
export interface ImageRow {
  readonly id: number;
  readonly kind: ImageKind;
  readonly storage_prefix: string;
  readonly variants: StoredImageVariants;
  readonly source_width: number;
  readonly source_height: number;
  readonly created_by_staff_id: number;
  readonly created_at: Date;
}

/** The columns of a new `images` row. */
export interface NewImageRow {
  readonly kind: ImageKind;
  readonly storage_prefix: string;
  readonly variants: StoredImageVariants;
  readonly source_width: number;
  readonly source_height: number;
  readonly created_by_staff_id: number;
  readonly created_at: Date;
}

// --- Uploads --------------------------------------------------------------------------------

/** The `Idempotency-Key` of an upload request, ready to claim in the upload's transaction. */
export interface UploadIdempotency {
  /** `staff:<id>` (or `anonymous`), as the write interceptor scopes keys. */
  readonly scope: string;
  readonly key: string;
  /** U1's request hash over the route, path params, text fields and the file's SHA-256. */
  readonly requestHash: string;
}

/** What `@UploadedImage()` gives an upload route: the one received file and its request. */
export interface ImageUploadPayload {
  readonly buffer: Buffer;
  readonly byteSize: number;
  /** Hex SHA-256 of the file, part of the idempotency request hash. */
  readonly fileSha256: string;
  /** Present when the request sent an `Idempotency-Key`. */
  readonly idempotency?: UploadIdempotency;
  /** The route's success status (`@HttpCode`, or Nest's default), stored with the key. */
  readonly successStatus: number;
}

/** What `MediaService.upload()` needs from the owner's upload route. */
export interface UploadImageInput<T> {
  readonly kind: ImageKind;
  readonly upload: ImageUploadPayload;
  /** The staff member uploading; recorded as `created_by_staff_id`. */
  readonly actor: StaffPrincipal;
  /**
   * Runs inside the upload's short transaction once the `images` row exists: insert or update
   * the owner's row, delete a replaced image, and return the response body. A throw rolls the
   * row back and deletes the new files.
   */
  link(image: StoredImage): Promise<T>;
}

/** What an upload answered: the status and body, and whether they replay an earlier request. */
export interface UploadOutcome<T> {
  readonly status: number;
  readonly body: T;
  readonly replayed: boolean;
}

/** `@ImageUpload()` options: the DTO of the text fields sent with the file, if any. */
export interface ImageUploadOptions {
  readonly fields?: Type<unknown>;
}

// --- Storage --------------------------------------------------------------------------------

/** One file to store. Paths are `<kind>/<uuid>/<variant>.webp`. */
export interface StorageObject {
  readonly path: string;
  readonly body: Buffer;
  readonly contentType: 'image/webp';
}

/** One stored file, as a listing reports it. */
export interface StorageListEntry {
  readonly path: string;
  /** When the file was last written. */
  readonly updatedAt: Date;
  /** Size in bytes, when the storage reports it. */
  readonly bytes: number | null;
}

/** One entry of Supabase Storage's list response; `id` is null for a folder. */
export interface SupabaseListItem {
  readonly name: string;
  readonly id: string | null;
  readonly updated_at?: string | null;
  readonly created_at?: string | null;
  readonly metadata?: { readonly size?: number } | null;
}

// --- Orphans --------------------------------------------------------------------------------

/** A storage prefix with no `images` row. */
export interface OrphanPrefix {
  readonly prefix: string;
  readonly paths: readonly string[];
  /** Sum of the files' sizes, when the storage reports them. */
  readonly bytes: number | null;
  readonly newestAt: Date;
}

/** What `npm run media:orphans` found. */
export interface OrphanReport {
  /** Orphaned prefixes old enough to remove. */
  readonly orphans: readonly OrphanPrefix[];
  /** Orphaned prefixes younger than the minimum age: possibly an upload in flight. */
  readonly recent: readonly OrphanPrefix[];
  /** Paths outside `<kind>/<uuid>/…`: reported, never removed. */
  readonly unknownPaths: readonly string[];
  /** Prefixes that have their row. */
  readonly linkedPrefixes: number;
}

/** The options of `npm run media:orphans`. */
export interface OrphanCommandOptions {
  readonly delete: boolean;
}
