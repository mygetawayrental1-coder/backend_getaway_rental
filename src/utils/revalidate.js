const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET || 'mgwr_secret_revalidate_2026';

/**
 * Triggers Next.js on-demand cache revalidation on the website.
 * Pings /api/revalidate on each frontend URL configured in FRONTEND_URL.
 */
async function triggerWebsiteRevalidation({ tags = [], paths = [] } = {}) {
  const urls = (process.env.FRONTEND_URL || 'https://my-get-away-rental-website.vercel.app')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.startsWith('http'));

  for (const baseUrl of urls) {
    try {
      const query = new URLSearchParams();
      query.set('secret', REVALIDATE_SECRET);
      if (tags.length) query.set('tags', tags.join(','));
      if (paths.length) query.set('paths', paths.join(','));

      const targetUrl = `${baseUrl.replace(/\/$/, '')}/api/revalidate?${query.toString()}`;
      if (typeof fetch === 'function') {
        fetch(targetUrl, { method: 'POST' }).catch(() => {});
      }
    } catch (err) {
      console.error('[Revalidate] Error triggering revalidation on:', baseUrl, err.message);
    }
  }
}

module.exports = { triggerWebsiteRevalidation };
