// The two API axes of the compatibility policy (design §3.5). A pre-release until lace-platform
// integrates and 1.0.0 is cut.

/** The account API, the descriptor, the error codes and the progress events. */
export const PASSPORT_API_VERSION = '1.0.0-pre.0';

/** The service's HTTP wire (`ServiceWire`). */
export const PASSPORT_SERVICE_API_VERSION = '1.0.0-pre.0';

/** The path prefix of the service wire's major version; an old major is served beside it. */
export const PASSPORT_SERVICE_PATH_PREFIX = '/v1';
