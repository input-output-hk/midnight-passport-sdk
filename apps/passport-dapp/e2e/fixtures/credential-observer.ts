// Test-only module loaded by the isolated browser runner, never the application.
// Running as a browser module keeps transpiler helpers in the same realm.
export {};
const frames: string[] = [];
const observations: { purpose: string; attempt: number }[] = [];
const failureCodes: string[] = [];
const approvals = new Set<string>();
document.getElementById('ceremony-continue')!.addEventListener('click', () => {
  const dialog = document.getElementById('ceremony-dialog') as HTMLDialogElement;
  if (dialog.open && dialog.dataset.ceremonyId) approvals.add(dialog.dataset.ceremonyId);
});
Object.assign(window, {
  __passportPurposeObservations: observations,
  __passportPurposeFailureCodes: failureCodes,
});
const refuse = (code: string): never => {
  failureCodes.push(code);
  throw new Error(code);
};
const frame = () => {
  const notice = document.getElementById('ceremony-purpose')!;
  frames.push(notice.hidden ? '' : (notice.textContent ?? ''));
  if (frames.length > 2) frames.shift();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
const observe = (
  method: 'create' | 'get',
  options: CredentialCreationOptions | CredentialRequestOptions,
) => {
  const notice = document.getElementById('ceremony-purpose')!;
  const purpose = notice.dataset.purpose ?? '';
  const attempt = Number(notice.dataset.attempt);
  const rect = notice.getBoundingClientRect();
  const text = notice.textContent ?? '';
  const prf = options.publicKey?.extensions?.prf;
  const expected =
    method === 'create'
      ? ['create']
      : prf
        ? ['derive-keys']
        : ['verify-created', 'identify', 'sign'];
  const ceremonyId = notice.dataset.ceremonyId ?? '';
  if (!approvals.delete(ceremonyId)) refuse('UnapprovedCredentialAccess');
  if (
    notice.hidden ||
    notice.dataset.ready !== 'true' ||
    !expected.includes(purpose) ||
    !Number.isInteger(attempt) ||
    attempt < 1
  )
    refuse('UnexplainedCredentialAccess');
  if (
    rect.top < 0 ||
    rect.bottom > innerHeight ||
    rect.height === 0 ||
    getComputedStyle(notice).visibility === 'hidden'
  )
    refuse('InvisibleCredentialPurpose');
  if (frames.length !== 2 || !frames.every((seen) => seen === text && seen.length > 0))
    refuse('InsufficientRenderingFrames');
  observations.push({ purpose, attempt });
};
const credentials = navigator.credentials;
const create = credentials.create.bind(credentials);
const get = credentials.get.bind(credentials);
Object.defineProperty(credentials, 'create', {
  configurable: true,
  value: (options: CredentialCreationOptions) => {
    observe('create', options);
    return create(options);
  },
});
Object.defineProperty(credentials, 'get', {
  configurable: true,
  value: (options: CredentialRequestOptions) => {
    observe('get', options);
    return get(options);
  },
});
