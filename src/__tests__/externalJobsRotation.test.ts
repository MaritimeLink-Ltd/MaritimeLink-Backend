import {
  pickRotationSlice,
  rotationDayIndex,
  ROTATION_START,
} from '../services/externalJobs/rotation.js';

describe('pickRotationSlice', () => {
  const grid = ['a', 'b', 'c', 'd', 'e'];

  it('returns budget entries starting from the front on day 0', () => {
    expect(pickRotationSlice(grid, 0, 2)).toEqual(['a', 'b']);
  });

  it('advances the offset by budget on each subsequent day', () => {
    expect(pickRotationSlice(grid, 1, 2)).toEqual(['c', 'd']);
  });

  it('wraps around once the grid is exhausted', () => {
    expect(pickRotationSlice(grid, 2, 2)).toEqual(['e', 'a']);
  });

  it('caps the slice length to the grid size even with a larger budget', () => {
    expect(pickRotationSlice(grid, 0, 100)).toHaveLength(5);
  });

  it('returns an empty slice when the budget is zero or negative', () => {
    expect(pickRotationSlice(grid, 0, 0)).toEqual([]);
    expect(pickRotationSlice(grid, 0, -3)).toEqual([]);
  });

  it('returns an empty slice for an empty grid', () => {
    expect(pickRotationSlice([], 3, 5)).toEqual([]);
  });

  it('is deterministic for the same inputs', () => {
    expect(pickRotationSlice(grid, 4, 3)).toEqual(
      pickRotationSlice(grid, 4, 3),
    );
  });
});

describe('rotationDayIndex', () => {
  it('is 0 on the rotation start date', () => {
    expect(rotationDayIndex(ROTATION_START)).toBe(0);
  });

  it('is 0 (clamped) for any date before rotation start', () => {
    const before = new Date(ROTATION_START.getTime() - 24 * 60 * 60 * 1000);
    expect(rotationDayIndex(before)).toBe(0);
  });

  it('advances by whole days after rotation start', () => {
    const threeDaysLater = new Date(
      ROTATION_START.getTime() + 3 * 24 * 60 * 60 * 1000 + 1000,
    );
    expect(rotationDayIndex(threeDaysLater)).toBe(3);
  });
});
