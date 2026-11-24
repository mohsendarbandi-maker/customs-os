export const isCloudflareRecoveryHost = (): boolean => isCloudflareStagingHost();

// Only the isolated workers.dev migration hostname uses the temporary staging
// workspace and its single-admin D1 session. Production custom domains continue
// using the current production authentication flow until multi-user D1 Auth passes
// its import, authorization, session, and regression gates.
export const isCloudflareStagingHost = (): boolean => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname.startsWith('customs-os-migration-staging.') &&
    hostname.endsWith('.workers.dev');
};
