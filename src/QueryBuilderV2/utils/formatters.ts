const formatterCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

export const getNumberFixedFormatter = (digits = 2, minDigits = 2) => {
  return new Intl.NumberFormat('en-US', {
    style: 'decimal',
    minimumFractionDigits: minDigits,
    maximumFractionDigits: digits,
  });
};

const getCurrencyFixedFormatter = (digits = 0, minDigits = 0) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'VND',
    minimumFractionDigits: minDigits,
    maximumFractionDigits: digits,
  });

const formatterNumber = getNumberFixedFormatter(3, 0);

export function formatNumber(amount: number, digits?: number, minDigits?: number) {
  return typeof digits === 'undefined' && typeof minDigits === 'undefined'
    ? formatterNumber.format(amount)
    : getNumberFixedFormatter(digits ?? 2, minDigits ?? 0).format(amount);
}

export function formatCurrency(amount: number, digits?: number, minDigits?: number) {
  return typeof digits === 'undefined' && typeof minDigits === 'undefined'
    ? formatterCurrency.format(amount)
    : getCurrencyFixedFormatter(digits ?? 2, minDigits ?? digits ?? 2).format(amount);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
