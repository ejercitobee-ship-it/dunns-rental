import { describe, it, expect } from 'vitest';
import {
  landValueFor,
  depreciableBasis,
  depreciationForYear,
  accumulatedDepreciation,
  RESIDENTIAL_RECOVERY_YEARS,
  DEFAULT_LAND_RATIO,
} from './depreciation';

describe('landValueFor', () => {
  it('uses the explicit land value when set', () => {
    expect(landValueFor({ purchasePrice: 300000, landValue: 90000 })).toBe(90000);
  });

  it('falls back to the default land ratio of the purchase price', () => {
    expect(landValueFor({ purchasePrice: 300000 })).toBe(300000 * DEFAULT_LAND_RATIO);
  });

  it('is zero without a purchase price', () => {
    expect(landValueFor({})).toBe(0);
  });

  it('treats an explicit zero land value as zero (all building)', () => {
    expect(landValueFor({ purchasePrice: 300000, landValue: 0 })).toBe(0);
  });
});

describe('depreciableBasis', () => {
  it('is purchase price minus land', () => {
    expect(depreciableBasis({ purchasePrice: 300000, landValue: 60000 })).toBe(240000);
  });

  it('applies the default land ratio when land is not set', () => {
    // 300000 - 20% = 240000
    expect(depreciableBasis({ purchasePrice: 300000 })).toBe(240000);
  });

  it('is zero without a purchase price', () => {
    expect(depreciableBasis({})).toBe(0);
  });

  it('is zero if land meets or exceeds the price', () => {
    expect(depreciableBasis({ purchasePrice: 100000, landValue: 100000 })).toBe(0);
  });
});

describe('depreciationForYear (straight-line, mid-month, 27.5yr)', () => {
  const basis275k = { purchasePrice: 275000, landValue: 0 }; // basis 275000, annual 10000

  it('is zero before the placed-in-service year', () => {
    expect(depreciationForYear({ ...basis275k, purchaseDate: '2022-06-15' }, 2021)).toBe(0);
  });

  it('prorates the first year by the mid-month convention (January placement)', () => {
    // annual = 275000 / 27.5 = 10000; Jan -> (12 - 1 + 0.5)/12 = 11.5/12
    const first = depreciationForYear({ ...basis275k, purchaseDate: '2020-01-10' }, 2020);
    expect(first).toBeCloseTo(10000 * (11.5 / 12), 2); // 9583.33
  });

  it('gives a full annual amount in a middle year', () => {
    expect(depreciationForYear({ ...basis275k, purchaseDate: '2020-01-10' }, 2021)).toBeCloseTo(10000, 2);
  });

  it('prorates a mid-year (June) placement by the mid-month convention', () => {
    // June (month 6): (12 - 6 + 0.5)/12 = 6.5/12; annual 10000 -> 5416.67
    const june = depreciationForYear({ ...basis275k, purchaseDate: '2020-06-20' }, 2020);
    expect(june).toBeCloseTo(10000 * (6.5 / 12), 2);
  });

  it('never lets accumulated depreciation exceed the basis', () => {
    const input = { ...basis275k, purchaseDate: '2020-01-10' };
    // Far past the 27.5-year life: current-year depreciation is zero and the
    // running total equals the basis exactly.
    expect(depreciationForYear(input, 2060)).toBe(0);
    expect(accumulatedDepreciation(input, 2060)).toBe(275000);
  });

  it('fully depreciates the basis across its recovery life', () => {
    const input = { purchasePrice: 275000, landValue: 0, purchaseDate: '2020-01-10' };
    // Sum of every year's depreciation equals the basis.
    let total = 0;
    for (let y = 2020; y <= 2060; y++) total += depreciationForYear(input, y);
    expect(total).toBeCloseTo(275000, 1);
  });

  it('is zero without a purchase date (cannot place in service)', () => {
    expect(depreciationForYear({ purchasePrice: 275000, landValue: 0 }, 2024)).toBe(0);
  });

  it('is zero without a purchase price', () => {
    expect(depreciationForYear({ purchaseDate: '2020-01-10' }, 2024)).toBe(0);
  });
});

describe('constants', () => {
  it('uses the residential 27.5-year recovery period', () => {
    expect(RESIDENTIAL_RECOVERY_YEARS).toBe(27.5);
  });
});
