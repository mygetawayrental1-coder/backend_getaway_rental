process.env.NODE_ENV = 'development';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_SUITABILITY = JSON.stringify({
    pets: false,
    children: true,
    smoking: false,
    wheelchair: false,
    elder: true,
});

function suitability(overrides = {}) {
    return JSON.stringify({
        pets: false,
        children: true,
        smoking: false,
        wheelchair: false,
        elder: true,
        ...overrides,
    });
}

async function upsertPlan(plan) {
    const existing = await prisma.subscriptionPlan.findFirst({
        where: { name: plan.name },
    });
    if (existing) {
        await prisma.subscriptionPlan.update({
            where: { id: existing.id },
            data: plan,
        });
        return existing.id;
    }
    const created = await prisma.subscriptionPlan.create({ data: plan });
    return created.id;
}

async function main() {
    console.log('Starting database seed (Clerk-only users, no passwords)...');

    // ============================================
    // 1. USERS
    // ============================================
    console.log('\n--- Seeding users ---');

    const admin = await prisma.user.upsert({
        where: { email: 'admin@mygatewayrentals.com' },
        update: {
            clerkId: 'seed_admin_001',
            firstName: 'Admin',
            lastName: 'User',
            role: 'ADMIN',
            phoneNumber: '5550001234',
            address: 'Admin Office, New York, NY',
        },
        create: {
            clerkId: 'seed_admin_001',
            email: 'admin@mygatewayrentals.com',
            firstName: 'Admin',
            lastName: 'User',
            role: 'ADMIN',
            phoneNumber: '5550001234',
            address: 'Admin Office, New York, NY',
        },
    });
    console.log('Created admin:', admin.email, `(${admin.clerkId})`);

    const ownerData = [
        { clerkId: 'seed_owner_001', email: 'owner@mygatewayrentals.com', firstName: 'John', lastName: 'Doe', phone: '5551234567', address: '123 Main St, Miami, FL' },
        { clerkId: 'seed_owner_002', email: 'james.smith@gmail.com', firstName: 'James', lastName: 'Smith', phone: '5552345678', address: '456 Ocean Blvd, Malibu, CA' },
        { clerkId: 'seed_owner_003', email: 'emily.davis@gmail.com', firstName: 'Emily', lastName: 'Davis', phone: '5553456789', address: '789 Mountain View Dr, Aspen, CO' },
        { clerkId: 'seed_owner_004', email: 'michael.jackson@gmail.com', firstName: 'Michael', lastName: 'Jackson', phone: '5559876543', address: '321 Ocean Drive, Los Angeles, CA' },
    ];

    const owners = [];
    for (const data of ownerData) {
        const owner = await prisma.user.upsert({
            where: { email: data.email },
            update: {
                clerkId: data.clerkId,
                firstName: data.firstName,
                lastName: data.lastName,
                countryCode: '+1',
                phoneNumber: data.phone,
                address: data.address,
                role: 'OWNER',
            },
            create: {
                clerkId: data.clerkId,
                email: data.email,
                firstName: data.firstName,
                lastName: data.lastName,
                countryCode: '+1',
                phoneNumber: data.phone,
                address: data.address,
                role: 'OWNER',
            },
        });
        owners.push(owner);
        console.log('Created owner:', owner.email, `(${owner.clerkId})`);
    }

    const endUserData = [
        { clerkId: 'seed_user_001', email: 'user@mygatewayrentals.com', firstName: 'Jane', lastName: 'Smith' },
        { clerkId: 'seed_user_002', email: 'chris.taylor@gmail.com', firstName: 'Chris', lastName: 'Taylor' },
        { clerkId: 'seed_user_003', email: 'sarah.wilson@gmail.com', firstName: 'Sarah', lastName: 'Wilson' },
        { clerkId: 'seed_user_004', email: 'david.brown@gmail.com', firstName: 'David', lastName: 'Brown' },
        { clerkId: 'seed_user_005', email: 'jessica.martinez@gmail.com', firstName: 'Jessica', lastName: 'Martinez' },
    ];

    const endUsers = [];
    for (const data of endUserData) {
        const user = await prisma.user.upsert({
            where: { email: data.email },
            update: {
                clerkId: data.clerkId,
                firstName: data.firstName,
                lastName: data.lastName,
                role: 'END_USER',
            },
            create: {
                clerkId: data.clerkId,
                email: data.email,
                firstName: data.firstName,
                lastName: data.lastName,
                role: 'END_USER',
            },
        });
        endUsers.push(user);
        console.log('Created end user:', user.email, `(${user.clerkId})`);
    }

    // ============================================
    // 2. SUBSCRIPTION PLANS
    // ============================================
    console.log('\n--- Seeding subscription plans ---');

    const planDefs = [
        {
            name: 'Starter',
            price: 9.99,
            duration: 'Monthly',
            maxProperties: 1,
            features: JSON.stringify(['1 property listing', 'Basic analytics', 'Email support']),
            status: 'Active',
        },
        {
            name: 'Professional',
            price: 24.99,
            duration: 'Monthly',
            maxProperties: 5,
            features: JSON.stringify(['Up to 5 listings', 'Advanced analytics', 'Priority support', 'Featured listing badge']),
            status: 'Active',
        },
        {
            name: 'Business',
            price: 49.99,
            duration: 'Monthly',
            maxProperties: 20,
            features: JSON.stringify(['Up to 20 listings', 'Full analytics dashboard', '24/7 support', 'Multiple featured badges', 'Custom pricing requests']),
            status: 'Active',
        },
    ];

    const planIds = {};
    for (const plan of planDefs) {
        planIds[plan.name] = await upsertPlan(plan);
        console.log('Created plan:', plan.name);
    }

    // ============================================
    // 3. PROPERTIES (22)
    // ============================================
    console.log('\n--- Seeding properties ---');

    const properties = [
        {
            propertyId: 'prop-001', slug: 'oceanfront-villa-miami', propertyName: 'Oceanfront Villa Miami', location: 'Miami Beach', state: 'Florida', country: 'USA',
            latitude: '25.7617', longitude: '-80.1918', guests: 8, bedrooms: 4, bathrooms: 3, kitchens: 1,
            nightlyRate: 450, weekendRate: 550, weeklyRate: 2800, monthlyRate: 10000, minRate: 350,
            rentalType: 'House', areaM2: 320, discountPercent: 10, isFeatured: true, isNew: false,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Swimming Pool', 'Air Conditioning', 'Kitchen', 'TV']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Beautiful oceanfront villa with stunning views. Perfect for family vacations or group getaways.',
            policyAndHouseRules: 'No smoking, No pets, Check-in after 3 PM, Check-out before 11 AM',
            images: JSON.stringify(['https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800', 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800']),
            status: 'Active', ownerId: owners[0].id,
        },
        {
            propertyId: 'prop-002', slug: 'malibu-beach-house', propertyName: 'Malibu Beach House', location: 'Malibu', state: 'California', country: 'USA',
            latitude: '34.0259', longitude: '-118.7798', guests: 6, bedrooms: 3, bathrooms: 2, kitchens: 1,
            nightlyRate: 550, weekendRate: 700, weeklyRate: 3500, monthlyRate: 12000, minRate: 450,
            rentalType: 'House', areaM2: 240, discountPercent: null, isFeatured: true, isNew: true,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Swimming Pool', 'Air Conditioning', 'Kitchen', 'TV', 'Gym']),
            suitability: suitability({ pets: true }),
            about: 'Stunning beach house on the Malibu coastline. Walking distance to the beach.',
            policyAndHouseRules: 'No smoking indoors, Pets allowed, Check-in after 2 PM',
            images: JSON.stringify(['https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=800', 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800']),
            status: 'Active', ownerId: owners[1].id,
        },
        {
            propertyId: 'prop-003', slug: 'aspen-mountain-lodge', propertyName: 'Aspen Mountain Lodge', location: 'Aspen', state: 'Colorado', country: 'USA',
            latitude: '39.1911', longitude: '-106.8175', guests: 4, bedrooms: 2, bathrooms: 1, kitchens: 1,
            nightlyRate: 400, weekendRate: 500, weeklyRate: 2500, monthlyRate: 9000, minRate: 350,
            rentalType: 'House', areaM2: 180, discountPercent: 5, isFeatured: true, isNew: false,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Kitchen', 'TV', 'Fireplace', 'Hot Tub']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Cozy mountain lodge with breathtaking Rocky Mountain views. Perfect for a ski retreat.',
            policyAndHouseRules: 'No parties, No smoking, Check-in after 1 PM',
            images: JSON.stringify(['https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800']),
            status: 'Active', ownerId: owners[2].id,
        },
        {
            propertyId: 'prop-004', slug: 'downtown-la-penthouse', propertyName: 'Downtown LA Penthouse', location: 'Los Angeles', state: 'California', country: 'USA',
            latitude: '34.0522', longitude: '-118.2437', guests: 10, bedrooms: 5, bathrooms: 4, kitchens: 2,
            nightlyRate: 800, weekendRate: 1000, weeklyRate: 5000, monthlyRate: 18000, minRate: 700,
            rentalType: 'Condo', areaM2: 400, discountPercent: null, isFeatured: true, isNew: true,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Swimming Pool', 'Air Conditioning', 'Kitchen', 'TV', 'Gym']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Luxurious penthouse with city skyline views. Perfect for corporate events.',
            policyAndHouseRules: 'No smoking, No pets, Check-in after 4 PM',
            images: JSON.stringify(['https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800']),
            status: 'Active', ownerId: owners[3].id,
        },
        {
            propertyId: 'prop-005', slug: 'key-west-beach-bungalow', propertyName: 'Key West Beach Bungalow', location: 'Key West', state: 'Florida', country: 'USA',
            latitude: '24.5551', longitude: '-81.7800', guests: 4, bedrooms: 2, bathrooms: 2, kitchens: 1,
            nightlyRate: 350, weekendRate: 450, weeklyRate: 2200, monthlyRate: 8000, minRate: 300,
            rentalType: 'House', areaM2: 120, discountPercent: null, isFeatured: false, isNew: true,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Air Conditioning', 'Kitchen', 'TV']),
            suitability: suitability({ pets: true }),
            about: 'Charming Key West bungalow with tropical vibes. Steps from the beach.',
            policyAndHouseRules: 'No parties, Pets allowed, Check-in after 12 PM',
            images: JSON.stringify(['https://images.unsplash.com/photo-1507089947368-19c1da9775ae?w=800', 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800']),
            status: 'Pending', ownerId: owners[1].id,
        },
        {
            propertyId: 'prop-006', slug: 'scottsdale-desert-estate', propertyName: 'Scottsdale Desert Estate', location: 'Scottsdale', state: 'Arizona', country: 'USA',
            latitude: '33.4942', longitude: '-111.9261', guests: 12, bedrooms: 6, bathrooms: 4, kitchens: 1,
            nightlyRate: 900, weekendRate: 1100, weeklyRate: 5500, monthlyRate: 20000, minRate: 800,
            rentalType: 'House', areaM2: 520, discountPercent: 15, isFeatured: false, isNew: false,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Swimming Pool', 'Air Conditioning', 'Kitchen', 'TV']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Stunning desert estate with southwest architecture and modern luxuries.',
            policyAndHouseRules: 'No smoking, No pets, Check-in after 2 PM',
            images: JSON.stringify(['https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800', 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800']),
            status: 'Active', ownerId: owners[2].id,
        },
        {
            propertyId: 'prop-007', slug: 'manhattan-studio-nyc', propertyName: 'Manhattan Studio NYC', location: 'New York City', state: 'New York', country: 'USA',
            latitude: '40.7580', longitude: '-73.9855', guests: 2, bedrooms: 1, bathrooms: 1, kitchens: 1,
            nightlyRate: 275, weekendRate: 325, weeklyRate: 1700, monthlyRate: 6500, minRate: 250,
            rentalType: 'Studio', areaM2: 45, discountPercent: null, isFeatured: true, isNew: true,
            amenities: JSON.stringify(['Wifi', 'Air Conditioning', 'Kitchen', 'TV', 'Elevator']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Bright studio steps from Times Square and Central Park.',
            policyAndHouseRules: 'No smoking, No pets, Quiet hours after 10 PM',
            images: JSON.stringify(['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800']),
            status: 'Active', ownerId: owners[0].id,
        },
        {
            propertyId: 'prop-008', slug: 'lake-tahoe-cabin', propertyName: 'Lake Tahoe Cabin', location: 'Lake Tahoe', state: 'California', country: 'USA',
            latitude: '39.0968', longitude: '-120.0324', guests: 6, bedrooms: 3, bathrooms: 2, kitchens: 1,
            nightlyRate: 420, weekendRate: 520, weeklyRate: 2600, monthlyRate: 9500, minRate: 380,
            rentalType: 'House', areaM2: 200, discountPercent: 8, isFeatured: false, isNew: false,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Kitchen', 'Fireplace', 'Hot Tub', 'Lake Access']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Rustic cabin with lake views and private dock access.',
            policyAndHouseRules: 'No parties, Check-in after 3 PM',
            images: JSON.stringify(['https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800', 'https://images.unsplash.com/photo-1518780664699-ffc087ae005e?w=800']),
            status: 'Active', ownerId: owners[1].id,
        },
        {
            propertyId: 'prop-009', slug: 'napa-valley-guesthouse', propertyName: 'Napa Valley Vineyard Guesthouse', location: 'Napa', state: 'California', country: 'USA',
            latitude: '38.2975', longitude: '-122.2869', guests: 4, bedrooms: 2, bathrooms: 2, kitchens: 1,
            nightlyRate: 480, weekendRate: 580, weeklyRate: 2900, monthlyRate: 10500, minRate: 420,
            rentalType: 'House', areaM2: 160, discountPercent: null, isFeatured: true, isNew: false,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Kitchen', 'Wine Cellar', 'Garden', 'BBQ']),
            suitability: suitability({ pets: true }),
            about: 'Guesthouse nestled among rolling vineyards with tasting room nearby.',
            policyAndHouseRules: 'No smoking, Pets on approval, Check-in after 2 PM',
            images: JSON.stringify(['https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800', 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800']),
            status: 'Active', ownerId: owners[1].id,
        },
        {
            propertyId: 'prop-010', slug: 'austin-hill-country-ranch', propertyName: 'Austin Hill Country Ranch', location: 'Austin', state: 'Texas', country: 'USA',
            latitude: '30.2672', longitude: '-97.7431', guests: 8, bedrooms: 4, bathrooms: 3, kitchens: 1,
            nightlyRate: 520, weekendRate: 620, weeklyRate: 3100, monthlyRate: 11000, minRate: 450,
            rentalType: 'House', areaM2: 350, discountPercent: 10, isFeatured: false, isNew: true,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Pool', 'Kitchen', 'BBQ', 'Fire Pit']),
            suitability: suitability({ pets: true }),
            about: 'Sprawling ranch with live oak shade and downtown Austin minutes away.',
            policyAndHouseRules: 'No smoking indoors, Pets allowed',
            images: JSON.stringify(['https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800']),
            status: 'Active', ownerId: owners[2].id,
        },
        {
            propertyId: 'prop-011', slug: 'chicago-riverfront-loft', propertyName: 'Chicago Riverfront Loft', location: 'Chicago', state: 'Illinois', country: 'USA',
            latitude: '41.8781', longitude: '-87.6298', guests: 4, bedrooms: 2, bathrooms: 2, kitchens: 1,
            nightlyRate: 310, weekendRate: 380, weeklyRate: 1900, monthlyRate: 7200, minRate: 280,
            rentalType: 'Apartment', areaM2: 110, discountPercent: null, isFeatured: false, isNew: true,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Air Conditioning', 'Kitchen', 'TV', 'Gym']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Industrial loft with floor-to-ceiling windows overlooking the Chicago River.',
            policyAndHouseRules: 'No smoking, No parties',
            images: JSON.stringify(['https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800', 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800']),
            status: 'Active', ownerId: owners[3].id,
        },
        {
            propertyId: 'prop-012', slug: 'seattle-waterfront-condo', propertyName: 'Seattle Waterfront Condo', location: 'Seattle', state: 'Washington', country: 'USA',
            latitude: '47.6062', longitude: '-122.3321', guests: 3, bedrooms: 1, bathrooms: 1, kitchens: 1,
            nightlyRate: 290, weekendRate: 340, weeklyRate: 1750, monthlyRate: 6800, minRate: 260,
            rentalType: 'Condo', areaM2: 75, discountPercent: 5, isFeatured: false, isNew: false,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Kitchen', 'TV', 'Water View']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Modern condo on Puget Sound with ferry views and walkable Pike Place.',
            policyAndHouseRules: 'No smoking, Check-in after 4 PM',
            images: JSON.stringify(['https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800']),
            status: 'Active', ownerId: owners[0].id,
        },
        {
            propertyId: 'prop-013', slug: 'boston-historic-brownstone', propertyName: 'Boston Historic Brownstone', location: 'Boston', state: 'Massachusetts', country: 'USA',
            latitude: '42.3601', longitude: '-71.0589', guests: 5, bedrooms: 3, bathrooms: 2, kitchens: 1,
            nightlyRate: 380, weekendRate: 450, weeklyRate: 2300, monthlyRate: 8500, minRate: 340,
            rentalType: 'Townhome', areaM2: 190, discountPercent: null, isFeatured: true, isNew: false,
            amenities: JSON.stringify(['Wifi', 'Kitchen', 'Fireplace', 'TV', 'Historic Charm']),
            suitability: suitability({ wheelchair: true }),
            about: 'Renovated brownstone in Back Bay near museums and public gardens.',
            policyAndHouseRules: 'No smoking, No pets',
            images: JSON.stringify(['https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800', 'https://images.unsplash.com/photo-1600607687644-c7171b42498f?w=800']),
            status: 'Active', ownerId: owners[3].id,
        },
        {
            propertyId: 'prop-014', slug: 'honolulu-beachfront-condo', propertyName: 'Honolulu Beachfront Condo', location: 'Honolulu', state: 'Hawaii', country: 'USA',
            latitude: '21.3069', longitude: '-157.8583', guests: 4, bedrooms: 2, bathrooms: 2, kitchens: 1,
            nightlyRate: 620, weekendRate: 720, weeklyRate: 3800, monthlyRate: 14000, minRate: 550,
            rentalType: 'Condo', areaM2: 130, discountPercent: 12, isFeatured: true, isNew: true,
            amenities: JSON.stringify(['Wifi', 'Pool', 'Kitchen', 'Ocean View', 'Air Conditioning']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Waikiki condo with lanai overlooking the Pacific.',
            policyAndHouseRules: 'No smoking, Check-out before 10 AM',
            images: JSON.stringify(['https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800', 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800']),
            status: 'Active', ownerId: owners[1].id,
        },
        {
            propertyId: 'prop-015', slug: 'nashville-music-row-apartment', propertyName: 'Nashville Music Row Apartment', location: 'Nashville', state: 'Tennessee', country: 'USA',
            latitude: '36.1627', longitude: '-86.7816', guests: 3, bedrooms: 1, bathrooms: 1, kitchens: 1,
            nightlyRate: 220, weekendRate: 280, weeklyRate: 1400, monthlyRate: 5200, minRate: 200,
            rentalType: 'Apartment', areaM2: 65, discountPercent: null, isFeatured: false, isNew: true,
            amenities: JSON.stringify(['Wifi', 'Kitchen', 'TV', 'Parking']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Walk to honky-tonks and live music venues on Music Row.',
            policyAndHouseRules: 'No parties after midnight',
            images: JSON.stringify(['https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800']),
            status: 'Active', ownerId: owners[2].id,
        },
        {
            propertyId: 'prop-016', slug: 'charleston-southern-charm', propertyName: 'Charleston Southern Charm Home', location: 'Charleston', state: 'South Carolina', country: 'USA',
            latitude: '32.7765', longitude: '-79.9311', guests: 6, bedrooms: 3, bathrooms: 2, kitchens: 1,
            nightlyRate: 340, weekendRate: 410, weeklyRate: 2100, monthlyRate: 7800, minRate: 300,
            rentalType: 'House', areaM2: 210, discountPercent: null, isFeatured: false, isNew: false,
            amenities: JSON.stringify(['Wifi', 'Porch', 'Garden', 'Kitchen', 'Parking']),
            suitability: suitability({ pets: true }),
            about: 'Antebellum-style home with wraparound porch in the historic district.',
            policyAndHouseRules: 'No smoking indoors, Pets allowed',
            images: JSON.stringify(['https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800']),
            status: 'Active', ownerId: owners[0].id,
        },
        {
            propertyId: 'prop-017', slug: 'sedona-red-rock-retreat', propertyName: 'Sedona Red Rock Retreat', location: 'Sedona', state: 'Arizona', country: 'USA',
            latitude: '34.8697', longitude: '-111.7610', guests: 4, bedrooms: 2, bathrooms: 2, kitchens: 1,
            nightlyRate: 360, weekendRate: 430, weeklyRate: 2200, monthlyRate: 8200, minRate: 320,
            rentalType: 'House', areaM2: 150, discountPercent: 7, isFeatured: false, isNew: false,
            amenities: JSON.stringify(['Wifi', 'Hot Tub', 'Kitchen', 'Hiking Trails', 'Parking']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Desert retreat surrounded by red rock formations and hiking trails.',
            policyAndHouseRules: 'No smoking, Quiet retreat — no parties',
            images: JSON.stringify(['https://images.unsplash.com/photo-1518780664699-ffc087ae005e?w=800', 'https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800']),
            status: 'Active', ownerId: owners[2].id,
        },
        {
            propertyId: 'prop-018', slug: 'portland-eco-bungalow', propertyName: 'Portland Eco-Friendly Bungalow', location: 'Portland', state: 'Oregon', country: 'USA',
            latitude: '45.5152', longitude: '-122.6784', guests: 4, bedrooms: 2, bathrooms: 1, kitchens: 1,
            nightlyRate: 240, weekendRate: 290, weeklyRate: 1500, monthlyRate: 5600, minRate: 220,
            rentalType: 'House', areaM2: 100, discountPercent: null, isFeatured: false, isNew: true,
            amenities: JSON.stringify(['Wifi', 'Solar Power', 'Garden', 'Kitchen', 'Bike Storage']),
            suitability: suitability({ pets: true }),
            about: 'Eco-conscious bungalow in a walkable neighborhood near food carts.',
            policyAndHouseRules: 'Recycling required, Pets allowed',
            images: JSON.stringify(['https://images.unsplash.com/photo-1600607687644-c7171b42498f?w=800', 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800']),
            status: 'Active', ownerId: owners[3].id,
        },
        {
            propertyId: 'prop-019', slug: 'denver-mountain-view-townhome', propertyName: 'Denver Mountain View Townhome', location: 'Denver', state: 'Colorado', country: 'USA',
            latitude: '39.7392', longitude: '-104.9903', guests: 5, bedrooms: 3, bathrooms: 2, kitchens: 1,
            nightlyRate: 300, weekendRate: 360, weeklyRate: 1800, monthlyRate: 6800, minRate: 270,
            rentalType: 'Townhome', areaM2: 140, discountPercent: null, isFeatured: false, isNew: false,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Kitchen', 'Mountain View', 'Garage']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Three-story townhome with Rockies views and light rail access.',
            policyAndHouseRules: 'No smoking, No pets',
            images: JSON.stringify(['https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800']),
            status: 'Active', ownerId: owners[2].id,
        },
        {
            propertyId: 'prop-020', slug: 'miami-brickell-highrise', propertyName: 'Miami Brickell High-Rise', location: 'Miami', state: 'Florida', country: 'USA',
            latitude: '25.7617', longitude: '-80.1918', guests: 4, bedrooms: 2, bathrooms: 2, kitchens: 1,
            nightlyRate: 380, weekendRate: 460, weeklyRate: 2300, monthlyRate: 8600, minRate: 340,
            rentalType: 'Apartment', areaM2: 95, discountPercent: 10, isFeatured: true, isNew: true,
            amenities: JSON.stringify(['Wifi', 'Pool', 'Gym', 'Kitchen', 'City View', 'Concierge']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Sleek high-rise unit in Brickell with rooftop pool and bay views.',
            policyAndHouseRules: 'No smoking, No pets',
            images: JSON.stringify(['https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800', 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800']),
            status: 'Active', ownerId: owners[0].id,
        },
        {
            propertyId: 'prop-021', slug: 'las-vegas-strip-view-suite', propertyName: 'Las Vegas Strip View Suite', location: 'Las Vegas', state: 'Nevada', country: 'USA',
            latitude: '36.1699', longitude: '-115.1398', guests: 4, bedrooms: 2, bathrooms: 2, kitchens: 1,
            nightlyRate: 320, weekendRate: 420, weeklyRate: 2100, monthlyRate: 7800, minRate: 290,
            rentalType: 'Condo', areaM2: 105, discountPercent: null, isFeatured: false, isNew: true,
            amenities: JSON.stringify(['Wifi', 'Pool', 'Kitchen', 'Strip View', 'Air Conditioning']),
            suitability: DEFAULT_SUITABILITY,
            about: 'Suite with Strip views, minutes from shows and dining.',
            policyAndHouseRules: 'No smoking, No parties',
            images: JSON.stringify(['https://images.unsplash.com/photo-1605833556294-ea5c7a74f57d?w=800', 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800']),
            status: 'Inactive', ownerId: owners[1].id,
        },
        {
            propertyId: 'prop-022', slug: 'virginia-beach-oceanfront-cottage', propertyName: 'Virginia Beach Oceanfront Cottage', location: 'Virginia Beach', state: 'Virginia', country: 'USA',
            latitude: '36.8529', longitude: '-75.9780', guests: 6, bedrooms: 3, bathrooms: 2, kitchens: 1,
            nightlyRate: 330, weekendRate: 400, weeklyRate: 2000, monthlyRate: 7400, minRate: 290,
            rentalType: 'House', areaM2: 175, discountPercent: 5, isFeatured: false, isNew: false,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Beach Access', 'Kitchen', 'Deck', 'BBQ']),
            suitability: suitability({ pets: true, children: true }),
            about: 'Family-friendly cottage on the boardwalk with ocean breezes.',
            policyAndHouseRules: 'No smoking indoors, Pets allowed with deposit',
            images: JSON.stringify(['https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800', 'https://images.unsplash.com/photo-1507089947368-19c1da9775ae?w=800']),
            status: 'Active', ownerId: owners[3].id,
        },
    ];

    const createdProperties = [];
    for (const prop of properties) {
        const property = await prisma.property.upsert({
            where: { propertyId: prop.propertyId },
            update: prop,
            create: prop,
        });
        createdProperties.push(property);
        console.log('Created property:', property.propertyName);
    }

    // ============================================
    // 4. INQUIRIES
    // ============================================
    console.log('\n--- Seeding inquiries ---');

    const inquiryData = [
        { propertyId: createdProperties[0].id, propertyName: createdProperties[0].propertyName, fullName: 'Chris Taylor', email: 'chris.taylor@gmail.com', phone: '5554567890', gender: 'Male', guests: 4, totalAmount: 1800, message: 'Looking forward to a family vacation. Is the pool heated?', checkin: new Date('2026-02-15'), checkout: new Date('2026-02-19'), nights: 4, status: 'PENDING' },
        { propertyId: createdProperties[1].id, propertyName: createdProperties[1].propertyName, fullName: 'Sarah Wilson', email: 'sarah.wilson@gmail.com', phone: '5556789012', gender: 'Female', guests: 2, totalAmount: 16000, message: 'Honeymoon trip! Any special arrangements possible?', checkin: new Date('2026-03-01'), checkout: new Date('2026-03-03'), nights: 2, status: 'ACCEPTED' },
        { propertyId: createdProperties[2].id, propertyName: createdProperties[2].propertyName, fullName: 'David Brown', email: 'david.brown@gmail.com', phone: '5551234568', gender: 'Male', guests: 3, totalAmount: 22000, message: 'Planning a week-long trip with friends.', checkin: new Date('2026-04-10'), checkout: new Date('2026-04-17'), nights: 7, status: 'PENDING' },
        { propertyId: createdProperties[3].id, propertyName: createdProperties[3].propertyName, fullName: 'Jessica Martinez', email: 'jessica.martinez@gmail.com', phone: '5557890123', gender: 'Female', guests: 8, totalAmount: 5000, message: 'Corporate team outing for 2 nights.', checkin: new Date('2026-05-20'), checkout: new Date('2026-05-22'), nights: 2, status: 'BOOKED' },
        { propertyId: createdProperties[0].id, propertyName: createdProperties[0].propertyName, fullName: 'Jane Smith', email: 'user@mygatewayrentals.com', phone: '5551111111', gender: 'Female', guests: 6, totalAmount: 2700, message: 'Birthday celebration! Can we arrange a cake?', checkin: new Date('2026-06-01'), checkout: new Date('2026-06-07'), nights: 6, status: 'PENDING' },
        { propertyId: createdProperties[4].id, propertyName: createdProperties[4].propertyName, fullName: 'Ryan Miller', email: 'ryan.miller@gmail.com', phone: '5558901234', gender: 'Male', guests: 2, totalAmount: 10000, message: 'Weekend getaway with my wife.', checkin: new Date('2026-02-28'), checkout: new Date('2026-03-01'), nights: 2, status: 'REJECTED' },
        { propertyId: createdProperties[5].id, propertyName: createdProperties[5].propertyName, fullName: 'Ashley Thompson', email: 'ashley.thompson@gmail.com', phone: '5559012345', gender: 'Female', guests: 10, totalAmount: 6300, message: 'Destination wedding inquiry.', checkin: new Date('2026-11-15'), checkout: new Date('2026-11-22'), nights: 7, status: 'PENDING' },
        { propertyId: createdProperties[1].id, propertyName: createdProperties[1].propertyName, fullName: 'Robert Johnson', email: 'robert.johnson@gmail.com', phone: '5552223333', gender: 'Male', guests: 5, totalAmount: 40000, message: 'Family vacation during Christmas holidays.', checkin: new Date('2026-12-24'), checkout: new Date('2026-12-28'), nights: 4, status: 'PENDING' },
    ];

    const existingInquiries = await prisma.inquiry.count();
    if (existingInquiries === 0) {
        for (let i = 0; i < inquiryData.length; i++) {
            const inquiry = await prisma.inquiry.create({
                data: {
                    enquiryId: `INQ-2026-${String(i + 1).padStart(4, '0')}`,
                    ...inquiryData[i],
                    userId: endUsers[i % endUsers.length].id,
                    propertyImages: createdProperties.find((p) => p.id === inquiryData[i].propertyId)?.images,
                },
            });
            console.log('Created inquiry:', inquiry.enquiryId, 'for', inquiry.propertyName);
        }
    } else {
        console.log('Skipped inquiries (already seeded)');
    }

    // ============================================
    // 5. USER SUBSCRIPTIONS
    // ============================================
    console.log('\n--- Seeding user subscriptions ---');

    const existingSubs = await prisma.userSubscription.count();
    if (existingSubs === 0) {
        const subscriptions = [
            { userId: owners[0].id, planId: planIds.Professional, status: 'ACTIVE', months: 6 },
            { userId: owners[1].id, planId: planIds.Business, status: 'ACTIVE', months: 3 },
            { userId: owners[2].id, planId: planIds.Starter, status: 'EXPIRED', months: -1 },
            { userId: owners[3].id, planId: planIds.Professional, status: 'ACTIVE', months: 1 },
        ];

        for (const sub of subscriptions) {
            const startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 1);
            const endDate = new Date();
            endDate.setMonth(endDate.getMonth() + sub.months);

            await prisma.userSubscription.create({
                data: {
                    userId: sub.userId,
                    planId: sub.planId,
                    startDate,
                    endDate,
                    status: sub.status,
                },
            });
            console.log('Created subscription for owner');
        }
    } else {
        console.log('Skipped subscriptions (already seeded)');
    }

    // ============================================
    // 6. LOCATIONS
    // ============================================
    console.log('\n--- Seeding locations ---');

    const locationSeeds = [
        { name: 'United States', slug: 'united-states', parentSlug: null, image: 'https://images.unsplash.com/photo-1485738422979-f5c462d49f74?w=800', sortOrder: 1 },
        { name: 'California', slug: 'california', parentSlug: 'united-states', image: 'https://images.unsplash.com/photo-1449034446853-66c86144b0ad?w=800', sortOrder: 2 },
        { name: 'Los Angeles', slug: 'los-angeles', parentSlug: 'california', image: 'https://images.unsplash.com/photo-1580655653885-65763b2597d0?w=800', sortOrder: 3 },
        { name: 'New York City', slug: 'new-york-city', parentSlug: 'united-states', image: 'https://images.unsplash.com/photo-1499092346589-b9b6be3e94b2?w=800', sortOrder: 4 },
        { name: 'San Francisco', slug: 'san-francisco', parentSlug: 'california', image: 'https://images.unsplash.com/photo-1506146332389-18140dc7b2fb?w=800', sortOrder: 5 },
        { name: 'Nevada', slug: 'nevada', parentSlug: 'united-states', image: 'https://images.unsplash.com/photo-1605833556294-ea5c7a74f57d?w=800', sortOrder: 6 },
        { name: 'New Jersey', slug: 'new-jersey', parentSlug: 'united-states', image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800', sortOrder: 7 },
        { name: 'Virginia', slug: 'virginia', parentSlug: 'united-states', image: 'https://images.unsplash.com/photo-1599030290346-2d56f2b5b534?w=800', sortOrder: 8 },
        { name: 'Virginia Beach', slug: 'virginia-beach', parentSlug: 'virginia', image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800', sortOrder: 9 },
    ];

    for (const loc of locationSeeds) {
        await prisma.location.upsert({
            where: { slug: loc.slug },
            update: loc,
            create: { ...loc, isActive: true },
        });
        console.log('Created location:', loc.slug);
    }

    // ============================================
    // 7. BLOG POSTS
    // ============================================
    console.log('\n--- Seeding blog posts ---');

    const blogSeeds = [
        {
            slug: 'discover-hidden-beaches-us',
            title: 'Discover Hidden Beaches Across the US',
            excerpt: 'Uncover serene coastal escapes beyond the tourist crowds.',
            content: '<p>From the rugged Oregon coast to Florida\'s Gulf Keys, America offers unforgettable shoreline escapes. Pack light, respect local wildlife, and travel during shoulder seasons for quieter sands.</p>',
            category: 'Beauty beaches',
            thumbnailUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800',
            authorName: 'Travel Desk',
            readTimeMin: 6,
            tags: JSON.stringify(['travel', 'beaches', 'US']),
            isPublished: true,
        },
        {
            slug: 'national-parks-weekend-itineraries',
            title: 'National Parks: Weekend Itineraries',
            excerpt: 'Short trips that maximize trails, vistas, and wildlife.',
            content: '<p>Whether you choose Yosemite, Zion, or the Smokies, plan sunrise hikes and book lodging early. Carry plenty of water and check seasonal road closures.</p>',
            category: 'National parks',
            thumbnailUrl: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=800',
            authorName: 'Trail Notes',
            readTimeMin: 8,
            tags: JSON.stringify(['national parks', 'hiking', 'weekend']),
            isPublished: true,
        },
        {
            slug: 'cultural-events-calendar',
            title: 'Cultural Events Worth Planning Around',
            excerpt: 'Festivals and museums that define each destination.',
            content: '<p>Align your rental dates with local art walks, music festivals, and food weeks. Many cities publish annual calendars—bookmark them when choosing dates.</p>',
            category: 'Cultural events',
            thumbnailUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800',
            authorName: 'City Guides',
            readTimeMin: 5,
            tags: JSON.stringify(['culture', 'festivals', 'events']),
            isPublished: true,
        },
        {
            slug: 'mountain-cabin-checklist',
            title: 'Mountain Cabin Getaways: What to Pack',
            excerpt: 'Layers, traction, and booking tips for alpine stays.',
            content: '<p>Elevation changes temperatures fast—bring layers and traction devices in winter. Confirm driveway access and snow removal with your host.</p>',
            category: 'Mountains',
            thumbnailUrl: 'https://images.unsplash.com/photo-1518780664699-ffc087ae005e?w=800',
            authorName: 'Alpine Tips',
            readTimeMin: 4,
            tags: JSON.stringify(['mountains', 'cabins', 'packing']),
            isPublished: true,
        },
    ];

    for (const post of blogSeeds) {
        await prisma.blogPost.upsert({
            where: { slug: post.slug },
            update: post,
            create: post,
        });
        console.log('Created blog post:', post.slug);
    }

    console.log('\nDatabase seeding completed.');
    console.log('\nSeed users use placeholder clerkIds (seed_admin_001, seed_owner_001, etc.).');
    console.log('Production users are created via Clerk webhooks.');
    console.log('\nSummary:');
    console.log('  - 1 admin, 4 owners, 5 end users');
    console.log('  - 3 subscription plans (Starter, Professional, Business)');
    console.log('  - 22 properties');
    console.log('  - 8 inquiries (on fresh DB)');
    console.log('  - 4 owner subscriptions (on fresh DB)');
    console.log('  - 9 locations, 4 blog posts');
}

main().catch(console.error).finally(() => prisma.$disconnect());
