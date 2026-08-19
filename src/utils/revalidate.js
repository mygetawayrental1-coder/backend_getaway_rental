/**
 * Triggers Next.js on-demand cache revalidation on the website.
 * Pings /api/revalidate on each frontend URL configured in FRONTEND_URL.
 * Requires REVALIDATE_SECRET (must match website env) — no hardcoded fallback.
 */
async function triggerWebsiteRevalidation({ tags = [], paths = [] } = {}) {
  const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;
  if (!REVALIDATE_SECRET) {
    console.warn('[revalidate] Skipped — set REVALIDATE_SECRET in backend env.');
    return;
  }

  const urls = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.startsWith('http'));

  if (!urls.length) {
    console.warn('[revalidate] Skipped — set FRONTEND_URL in backend env.');
    return;
  }

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
