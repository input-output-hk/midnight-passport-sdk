// Synthetic, exact known GREASE variant on one mock assertion; no production behavior changes.
export {};
const credentials = navigator.credentials;
const get = credentials.get.bind(credentials);
let inject = true;
Object.defineProperty(credentials, 'get', {
  configurable: true,
  value: async (options: CredentialRequestOptions) => {
    const result = (await get(options)) as PublicKeyCredential;
    if (inject && !options.publicKey?.extensions?.prf) {
      inject = false;
      const response = result.response as AuthenticatorAssertionResponse;
      const original = new TextDecoder().decode(response.clientDataJSON);
      const suffix =
        ',"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}';
      Object.defineProperty(response, 'clientDataJSON', {
        value: new TextEncoder().encode(original.slice(0, -1) + suffix).buffer,
      });
    }
    return result;
  },
});
