import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatMonthYear(month: number, year: number): string {
  return new Date(year, month - 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export function getMonthName(month: number): string {
  return new Date(2024, month - 1).toLocaleDateString('en-US', { month: 'short' });
}

// YYYY-MM-DD from local date parts, not toISOString(): toISOString() is UTC
// and rolls back to yesterday's date for the owner in America/Chicago late
// in the day.
export function todayLocalDate(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// The year and month of a stored ISO date (YYYY-MM-DD), read as plain numbers.
//
// Never use new Date(dateStr).getFullYear() or .getMonth() for this. An ISO
// date only string parses as UTC midnight, so for anyone behind UTC it reads
// back as the previous day: 2026-01-01 becomes December 31, 2025. That filed
// first of the month expenses in the wrong month, and New Year's Day expenses
// in the wrong tax year.
export function yearOf(dateStr: string): number {
  return Number(dateStr?.slice(0, 4));
}

/** Month as 1 to 12, matching how rent payments store theirs. */
export function monthOf(dateStr: string): number {
  return Number(dateStr?.slice(5, 7));
}
