import { AppError } from '../../../../src/common/errors/app-error';
import { planCrop } from '../../../../src/modules/media/image-shape';

function shapeError(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected IMAGE_WRONG_SHAPE');
}

describe('planCrop', () => {
  it('keeps an exact 2:3 poster whole', () => {
    expect(planCrop('poster', 1000, 1500)).toEqual({ left: 0, top: 0, width: 1000, height: 1500 });
  });

  it('centre-crops a poster up to 2 % off to the exact ratio', () => {
    // 1020 × 1500 is 2 % too wide: 10 pixels come off each side.
    expect(planCrop('poster', 1020, 1500)).toEqual({ left: 10, top: 0, width: 1000, height: 1500 });
    // A 27 × 40 in poster (1.25 % wider than 2:3) loses a few columns.
    expect(planCrop('poster', 1000, 1481)).toEqual({ left: 6, top: 0, width: 987, height: 1481 });
  });

  it('refuses a poster more than 2 % off, with the rule in the details', () => {
    expect(shapeError(() => planCrop('poster', 1032, 1500)).code).toBe('IMAGE_WRONG_SHAPE');
    const error = shapeError(() => planCrop('poster', 1050, 1500));
    expect(error.code).toBe('IMAGE_WRONG_SHAPE');
    expect(error.details).toEqual({
      kind: 'poster',
      aspect: '2:3',
      minWidth: 400,
      minHeight: 600,
      width: 1050,
      height: 1500,
    });
  });

  it('refuses a poster below 400 × 600 even at the right ratio', () => {
    expect(shapeError(() => planCrop('poster', 398, 597)).code).toBe('IMAGE_WRONG_SHAPE');
  });

  it('accepts a square person photo of 600 × 600 and refuses 599 × 599 or a portrait', () => {
    expect(planCrop('person', 600, 600)).toEqual({ left: 0, top: 0, width: 600, height: 600 });
    expect(shapeError(() => planCrop('person', 599, 599)).details).toEqual(
      expect.objectContaining({ kind: 'person', aspect: '1:1', minWidth: 600, minHeight: 600 }),
    );
    expect(shapeError(() => planCrop('person', 800, 1000)).code).toBe('IMAGE_WRONG_SHAPE');
  });

  it('always centre-crops a backdrop to 16:9, then checks 1280 × 720', () => {
    // A 4:3 phone photo loses its top and bottom.
    expect(planCrop('backdrop', 1600, 1200)).toEqual({
      left: 0,
      top: 150,
      width: 1600,
      height: 900,
    });
    // A panorama loses its sides.
    expect(planCrop('backdrop', 4000, 1000)).toEqual({
      left: 1111,
      top: 0,
      width: 1778,
      height: 1000,
    });
    // 1280 × 960 crops to 1280 × 720: just enough. 1200 × 900 crops to 1200 × 675: too small.
    expect(planCrop('backdrop', 1280, 960).height).toBe(720);
    expect(shapeError(() => planCrop('backdrop', 1200, 900)).details).toEqual(
      expect.objectContaining({ kind: 'backdrop', aspect: '16:9', width: 1200, height: 900 }),
    );
  });

  it('keeps any gallery shape whose shorter side is at least 320', () => {
    expect(planCrop('gallery', 3000, 320)).toEqual({ left: 0, top: 0, width: 3000, height: 320 });
    expect(shapeError(() => planCrop('gallery', 3000, 319)).details).toEqual(
      expect.objectContaining({ kind: 'gallery', aspect: null, minWidth: 320, minHeight: 320 }),
    );
  });
});
