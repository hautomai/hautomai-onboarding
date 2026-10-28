export function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  const [firstName = '', ...rest] = parts;
  return { firstName, lastName: rest.join(' ') };
}

export function toIsoDate(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}