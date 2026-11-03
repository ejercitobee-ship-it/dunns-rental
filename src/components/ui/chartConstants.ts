import type { CSSProperties } from 'react';

export const INCOME_COLOR = '#2c7a58';
export const EXPENSE_COLOR = '#b98a5e';

export const CHART_TOOLTIP: CSSProperties = {
  borderRadius: '10px',
  border: '1px solid #e7e4dd',
  boxShadow: '0 4px 12px rgba(27,26,23,0.08), 0 1px 3px rgba(27,26,23,0.04)',
  fontSize: '13px',
};

export const CHART_AXIS = {
  stroke: '#a6a29a',
  fontSize: 11,
  tickLine: false as const,
  axisLine: false as const,
};

export const CHART_GRID = {
  strokeDasharray: '3 3',
  stroke: '#e7e4dd',
  vertical: false as const,
};
