const SOCIAL_PLATFORMS = [
  'facebook',
  'instagram',
  'x',
  'tiktok',
  'youtube',
  'linkedin',
];

function isHttpUrl(value) {
  if (value == null || String(value).trim() === '') return true;
  try {
    const u = new URL(String(value).trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isYouTubeUrl(value) {
  if (value == null || String(value).trim() === '') return true;
  if (!isHttpUrl(value)) return false;
  try {
    const u = new URL(String(value).trim());
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    return (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtu.be' ||
      host === 'youtube-nocookie.com'
    );
  } catch {
    return false;
  }
}

function normalizeSocialMediaUrls(raw) {
  if (raw == null || raw === '') return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out = {};
  for (const key of SOCIAL_PLATFORMS) {
    const v = obj[key];
    if (v == null || String(v).trim() === '') continue;
    out[key] = String(v).trim();
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Validate + normalize personal website / virtual tour / social media from body.
 * Returns { error } or { personalWebsiteUrl, virtualTourUrl, socialMediaUrls }.
 */
function parseListingLinksFromBody(body = {}) {
  const personalWebsiteUrl =
    body.personalWebsiteUrl != null && String(body.personalWebsiteUrl).trim() !== ''
      ? String(body.personalWebsiteUrl).trim()
      : null;
  const virtualTourUrl =
    body.virtualTourUrl != null && String(body.virtualTourUrl).trim() !== ''
      ? String(body.virtualTourUrl).trim()
      : null;

  if (personalWebsiteUrl && !isHttpUrl(personalWebsiteUrl)) {
    return { error: 'Personal website must be a valid http(s) URL.' };
  }
  if (virtualTourUrl && !isYouTubeUrl(virtualTourUrl)) {
    return { error: 'Virtual tour must be a valid YouTube URL.' };
  }

  let socialMediaUrls = null;
  if (body.socialMediaUrls !== undefined) {
    socialMediaUrls = normalizeSocialMediaUrls(body.socialMediaUrls);
    if (body.socialMediaUrls && String(body.socialMediaUrls).trim() !== '' && socialMediaUrls === null) {
      // Empty object after filter is ok; invalid JSON is error
      if (typeof body.socialMediaUrls === 'string') {
        try {
          JSON.parse(body.socialMediaUrls);
          socialMediaUrls = null;
        } catch {
          return { error: 'Social media links must be a valid JSON object.' };
        }
      }
    }
    if (socialMediaUrls) {
      for (const [k, v] of Object.entries(socialMediaUrls)) {
        if (!isHttpUrl(v)) {
          return { error: `Social media URL for ${k} must be a valid http(s) URL.` };
        }
      }
    }
  }

  return {
    personalWebsiteUrl:
      body.personalWebsiteUrl !== undefined ? personalWebsiteUrl : undefined,
    virtualTourUrl: body.virtualTourUrl !== undefined ? virtualTourUrl : undefined,
    socialMediaUrls:
      body.socialMediaUrls !== undefined
        ? socialMediaUrls
          ? JSON.stringify(socialMediaUrls)
          : null
        : undefined,
  };
}

/** Build display feature bullets from structured plan entitlements + custom features. */
function buildPlanFeatureBullets(plan) {
  const bullets = [];
  if (plan.maxPhotos == null) bullets.push('Unlimited Photos');
  else bullets.push(`${plan.maxPhotos} Photos`);

  bullets.push('Unlimited text description');

  if (plan.maxCalendarSyncs == null) bullets.push('Multiple Calendar Sync');
  else if (plan.maxCalendarSyncs === 1) bullets.push('1 Calendar Sync');
  else bullets.push(`${plan.maxCalendarSyncs} Calendar Sync`);

  if (plan.bookingManagement !== false) bullets.push('Booking Management');

  const support = (plan.supportType || 'EMAIL').toUpperCase();
  if (support === 'TICKET') bullets.push('Ticket support');
  else if (support === 'EMAIL') bullets.push('Email Support');

  if (plan.cityClassifiedListing) bullets.push('City classified listing');
  if (plan.personalWebsiteLink) bullets.push('Personal Website Link');
  if (plan.socialMediaLinks) bullets.push('Social Media Links');
  if (plan.virtualTourLink) bullets.push('Virtual Tour Link');
  if (plan.homepageFeaturedListing) bullets.push('Homepage featured listing');

  let custom = [];
  try {
    const raw = plan.features;
    if (typeof raw === 'string' && raw.trim()) custom = JSON.parse(raw);
    else if (Array.isArray(raw)) custom = raw;
  } catch {
    custom = [];
  }
  for (const c of custom) {
    const s = String(c || '').trim();
    if (s && !bullets.includes(s)) bullets.push(s);
  }
  return bullets;
}

function serializePlanForApi(plan, parseJsonField) {
  if (!plan) return plan;
  return {
    ...plan,
    features: buildPlanFeatureBullets(plan),
    customFeatures: parseJsonField ? parseJsonField(plan.features) : plan.features,
    maxPhotos: plan.maxPhotos ?? null,
    maxCalendarSyncs: plan.maxCalendarSyncs ?? null,
    bookingManagement: plan.bookingManagement !== false,
    supportType: plan.supportType || 'EMAIL',
    personalWebsiteLink: Boolean(plan.personalWebsiteLink),
    socialMediaLinks: Boolean(plan.socialMediaLinks),
    cityClassifiedListing: Boolean(plan.cityClassifiedListing),
    virtualTourLink: Boolean(plan.virtualTourLink),
    homepageFeaturedListing: Boolean(plan.homepageFeaturedListing),
    priceUnit: plan.priceUnit || 'FLAT',
  };
}

module.exports = {
  SOCIAL_PLATFORMS,
  isHttpUrl,
  isYouTubeUrl,
  normalizeSocialMediaUrls,
  parseListingLinksFromBody,
  buildPlanFeatureBullets,
  serializePlanForApi,
};
