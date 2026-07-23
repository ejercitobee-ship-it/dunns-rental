import { describe, it, expect } from 'vitest';
import { tradeMatches, maintenanceExpenseId } from './maintenance';

describe('tradeMatches', () => {
  it('offers a job to a handyman who works that trade', () => {
    expect(tradeMatches(['plumbing', 'hvac'], 'plumbing')).toBe(true);
  });

  it('does not offer a job outside their trades', () => {
    expect(tradeMatches(['plumbing'], 'electrical')).toBe(false);
  });

  it('a general handyman is offered everything', () => {
    expect(tradeMatches(['general'], 'electrical')).toBe(true);
    expect(tradeMatches(['general'], 'plumbing')).toBe(true);
  });

  it('a blank or missing category falls back to general', () => {
    expect(tradeMatches(['general'], undefined)).toBe(true);
    expect(tradeMatches(['plumbing'], '')).toBe(false);
    expect(tradeMatches(['general'], null)).toBe(true);
  });

  it('a handyman with no trades is offered nothing', () => {
    expect(tradeMatches([], 'plumbing')).toBe(false);
  });
});

describe('maintenanceExpenseId', () => {
  it('derives the expense id from the request id so pay and delete agree', () => {
    expect(maintenanceExpenseId('abc-123')).toBe('maint-abc-123');
  });
});
