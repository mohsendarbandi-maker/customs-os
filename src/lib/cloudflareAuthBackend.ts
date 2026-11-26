/**
 * Explicit opt-in for the future Cloudflare-only authentication cutover.
 * The default remains the existing provider until the complete backend migration
 * and production D1/Auth routing have passed their release gates.
 */
export const isCloudflareNativeAuthEnabled = () =>
  import.meta.env.VITE_CUSTOMS_AUTH_BACKEND?.trim().toLowerCase() === 'cloudflare';
