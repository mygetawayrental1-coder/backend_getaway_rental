/**
 * Upsert DynamicField defs for listing marketing links + Silver/Gold/Platinum plans.
 * Run: node scripts/seed_listing_link_fields.js
 */
const prisma = require('../src/config/database');

const LINK_FIELDS = [
  {
    name: 'personal_website_url',
    label: 'Personal website link',
    type: 'text',
    section: 'links',
    placeholder: 'https://your-website.com',
    required: false,
    isActive: true,
  },
  {
    name: 'social_media_links',
    label: 'Social media links',
    type: 'text',
    section: 'links',
    placeholder: 'Add Facebook, Instagram, X, etc.',
    required: false,
    isActive: true,
  },
  {
    name: 'virtual_tour_url',
    label: 'Virtual tour (YouTube)',
    type: 'text',
    section: 'links',
    placeholder: 'https://www.youtube.com/watch?v=…',
    required: false,
    isActive: true,
  },
];

const PACKAGES = [
  {
    name: 'Silver Package',
    price: 199,
    duration: 'Monthly',
    maxProperties: 1,
    priceUnit: 'FLAT',
    maxPhotos: 20,
    maxCalendarSyncs: 1,
    bookingManagement: true,
    supportType: 'EMAIL',
    personalWebsiteLink: false,
    socialMediaLinks: false,
    cityClassifiedListing: false,
    virtualTourLink: false,
    homepageFeaturedListing: false,
    features: JSON.stringify([]),
    status: 'Active',
  },
  {
    name: 'Gold Package',
    price: 299,
    duration: 'Monthly',
    maxProperties: 1,
    priceUnit: 'PER_LISTING',
    maxPhotos: 50,
    maxCalendarSyncs: 3,
    bookingManagement: true,
    supportType: 'EMAIL',
    personalWebsiteLink: true,
    socialMediaLinks: true,
    cityClassifiedListing: false,
    virtualTourLink: false,
    homepageFeaturedListing: false,
    features: JSON.stringify([]),
    status: 'Active',
  },
  {
    name: 'Platinum Package',
    price: 399,
    duration: 'Monthly',
    maxProperties: 5,
    priceUnit: 'PER_LISTING',
    maxPhotos: null,
    maxCalendarSyncs: null,
    bookingManagement: true,
    supportType: 'TICKET',
    personalWebsiteLink: true,
    socialMediaLinks: true,
    cityClassifiedListing: true,
    virtualTourLink: true,
    homepageFeaturedListing: true,
    features: JSON.stringify([]),
    status: 'Active',
  },
];

async function main() {
  for (const field of LINK_FIELDS) {
    await prisma.dynamicField.upsert({
      where: { name: field.name },
      create: field,
      update: {
        label: field.label,
        type: field.type,
        section: field.section,
        placeholder: field.placeholder,
        required: field.required,
        isActive: field.isActive,
      },
    });
    console.log('DynamicField:', field.name);
  }

  // Deactivate old seed plan names so pricing shows the new packages
  await prisma.subscriptionPlan.updateMany({
    where: {
      name: { in: ['Starter', 'Professional', 'Business', 'Enterprise'] },
      status: 'Active',
    },
    data: { status: 'Inactive' },
  });

  for (const plan of PACKAGES) {
    const existing = await prisma.subscriptionPlan.findFirst({
      where: { name: plan.name },
    });
    if (existing) {
      await prisma.subscriptionPlan.update({
        where: { id: existing.id },
        data: plan,
      });
      console.log('Updated plan:', plan.name);
    } else {
      await prisma.subscriptionPlan.create({ data: plan });
      console.log('Created plan:', plan.name);
    }
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
