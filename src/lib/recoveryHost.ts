export const isCloudflareRecoveryHost = (): boolean => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname.endsWith('.workers.dev') ||
    hostname === 'darbandicommercial.ir' ||
    hostname === 'mobile.darbandicommercial.ir';
};
