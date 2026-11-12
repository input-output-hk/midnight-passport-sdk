export const grantPage = '/grant.html';
export const grantNetwork = 'undeployed';
export const grantBinding = 'acc-s3r1.1';

export function isGrantOrigin(value: string | undefined): value is string {
  if (value?.length !== 21) return false;
  const url = URL.parse(value);
  return url?.protocol === 'https:' && url.origin === value;
}
