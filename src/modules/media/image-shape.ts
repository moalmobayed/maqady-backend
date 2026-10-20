import { AppError } from '../../common/errors/app-error';
import { ASPECT_TOLERANCE, KIND_RULES } from './media.constants';
import type { CropRegion, ImageKind, KindRule } from './types';

/**
 * Decides the part of the (EXIF-oriented) upload that becomes the image, by the kind's rules
 * (`KIND_RULES`), or refuses the upload with `IMAGE_WRONG_SHAPE`:
 *
 * - a kind without a ratio keeps the whole picture;
 * - a `refuse` kind (poster, person) accepts a ratio at most 2 % off and centre-crops it to the
 *   exact ratio; further off is refused, so a face or a title is never cut silently;
 * - a `crop` kind (backdrop) always centre-crops to its ratio.
 *
 * The kept region must then be at least the kind's minimum size.
 */
export function planCrop(kind: ImageKind, width: number, height: number): CropRegion {
  const rule = KIND_RULES[kind];
  const region = cropFor(rule, width, height);
  if (region === null || region.width < rule.minWidth || region.height < rule.minHeight) {
    throw wrongShape(kind, rule, width, height);
  }
  return region;
}

function cropFor(rule: KindRule, width: number, height: number): CropRegion | null {
  if (rule.aspect === null || rule.shape === 'keep') return { left: 0, top: 0, width, height };
  const [ratioWidth, ratioHeight] = rule.aspect;
  const target = ratioWidth / ratioHeight;
  if (rule.shape === 'refuse' && Math.abs(width / height / target - 1) > ASPECT_TOLERANCE) {
    return null;
  }
  // The largest centred rectangle of the exact ratio that fits in the picture.
  if (width / height > target) {
    const cropWidth = Math.round(height * target);
    return { left: Math.floor((width - cropWidth) / 2), top: 0, width: cropWidth, height };
  }
  const cropHeight = Math.round(width / target);
  return { left: 0, top: Math.floor((height - cropHeight) / 2), width, height: cropHeight };
}

function wrongShape(kind: ImageKind, rule: KindRule, width: number, height: number): AppError {
  return new AppError('IMAGE_WRONG_SHAPE', undefined, {
    kind,
    aspect: rule.aspect === null ? null : `${rule.aspect[0]}:${rule.aspect[1]}`,
    minWidth: rule.minWidth,
    minHeight: rule.minHeight,
    width,
    height,
  });
}
