export const isCloudflareRecoveryHost = (): boolean => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname.endsWith('.workers.dev') ||
    hostname === 'darbandicommercial.ir' ||
    hostname === 'mobile.darbandicommercial.ir';
};

// Only the isolated workers.dev migration hostname uses the temporary staging
// workspace. Production/custom domains are deliberately excluded from this gate.
export const isCloudflareStagingHost = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.toLowerCase().endsWith('.workers.dev');
};
