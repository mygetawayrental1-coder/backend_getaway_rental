const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting comprehensive database seed...');

    // ============================================
    // 1. CREATE USERS (Admin, Owners, End Users)
    // ============================================

    const adminPassword = await bcrypt.hash('Admin@123', 12);
    const ownerPassword = await bcrypt.hash('Owner@123', 12);
    const userPassword = await bcrypt.hash('User@123', 12);

    // Admin
    const admin = await prisma.user.upsert({
        where: { email: 'admin@mygatewayrentals.com' },
        update: {},
        create: {
            email: 'admin@mygatewayrentals.com',
            password: adminPassword,
            firstName: 'Admin',
            lastName: 'User',
            role: 'ADMIN',
            emailVerified: true,
            phoneNumber: '5550001234',
            address: 'Admin Office, New York, NY',
        },
    });
    console.log('✅ Created admin:', admin.email);

    // Owners
    const owners = [];
    const ownerData = [
        { email: 'owner@mygatewayrentals.com', firstName: 'John', lastName: 'Doe', phone: '5551234567', address: '123 Main St, Miami, FL' },
        { email: 'james.smith@gmail.com', firstName: 'James', lastName: 'Smith', phone: '5552345678', address: '456 Ocean Blvd, Malibu, CA' },
        { email: 'emily.davis@gmail.com', firstName: 'Emily', lastName: 'Davis', phone: '5553456789', address: '789 Mountain View Dr, Aspen, CO' },
        { email: 'michael.jackson@gmail.com', firstName: 'Michael', lastName: 'Jackson', phone: '5559876543', address: '321 Ocean Drive, Los Angeles, CA' },
    ];

    for (const data of ownerData) {
        const owner = await prisma.user.upsert({
            where: { email: data.email },
            update: {},
            create: {
                email: data.email,
                password: ownerPassword,
                firstName: data.firstName,
                lastName: data.lastName,
                countryCode: '+1',
                phoneNumber: data.phone,
                address: data.address,
                role: 'OWNER',
                emailVerified: true,
            },
        });
        owners.push(owner);
        console.log('✅ Created owner:', owner.email);
    }

    // End Users
    const endUsers = [];
    const endUserData = [
        { email: 'user@mygatewayrentals.com', firstName: 'Jane', lastName: 'Smith' },
        { email: 'chris.taylor@gmail.com', firstName: 'Chris', lastName: 'Taylor' },
        { email: 'sarah.wilson@gmail.com', firstName: 'Sarah', lastName: 'Wilson' },
        { email: 'david.brown@gmail.com', firstName: 'David', lastName: 'Brown' },
        { email: 'jessica.martinez@gmail.com', firstName: 'Jessica', lastName: 'Martinez' },
    ];

    for (const data of endUserData) {
        const user = await prisma.user.upsert({
            where: { email: data.email },
            update: {},
            create: {
                email: data.email,
                password: userPassword,
                firstName: data.firstName,
                lastName: data.lastName,
                role: 'END_USER',
                emailVerified: true,
            },
        });
        endUsers.push(user);
        console.log('✅ Created end user:', user.email);
    }

    // ============================================
    // 2. CREATE SUBSCRIPTION PLANS
    // ============================================

    const plans = [
        {
            id: 'silver',
            name: 'Silver',
            price: 999,
            specialPrice: 799,
            duration: 'Monthly',
            features: JSON.stringify(['List up to 3 properties', 'Basic analytics', 'Email support']),
            status: 'Active',
        },
        {
            id: 'gold',
            name: 'Gold',
            price: 1999,
            specialPrice: 1599,
            duration: 'Monthly',
            features: JSON.stringify(['List up to 10 properties', 'Advanced analytics', 'Priority support', 'Featured listings']),
            status: 'Active',
        },
        {
            id: 'platinum',
            name: 'Platinum',
            price: 4999,
            specialPrice: 3999,
            duration: 'Monthly',
            features: JSON.stringify(['Unlimited properties', 'Full analytics', '24/7 support', 'Featured listings', 'Marketing tools']),
            status: 'Active',
        },
        {
            id: 'diamond',
            name: 'Diamond',
            price: 9999,
            specialPrice: null,
            duration: 'Yearly',
            features: JSON.stringify(['Everything in Platinum', 'Dedicated account manager', 'Custom integrations', 'API access']),
            status: 'Active',
        },
    ];

    for (const plan of plans) {
        await prisma.subscriptionPlan.upsert({
            where: { id: plan.id },
            update: plan,
            create: plan,
        });
        console.log('✅ Created plan:', plan.name);
    }

    // ============================================
    // 3. CREATE PROPERTIES
    // ============================================

    const properties = [
        {
            propertyId: 'prop-001',
            propertyName: 'Oceanfront Villa Miami',
            location: 'Miami Beach',
            state: 'Florida',
            country: 'USA',
            latitude: '25.7617',
            longitude: '-80.1918',
            guests: 8,
            bedrooms: 4,
            bathrooms: 3,
            kitchens: 1,
            nightlyRate: 450,
            weekendRate: 550,
            weeklyRate: 2800,
            monthlyRate: 10000,
            minRate: 350,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Swimming Pool', 'Air Conditioning', 'Kitchen', 'TV']),
            about: 'Beautiful oceanfront villa with stunning views. Perfect for family vacations or group getaways.',
            policyAndHouseRules: 'No smoking, No pets, Check-in after 3 PM, Check-out before 11 AM',
            images: JSON.stringify([
                'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800',
                'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800',
            ]),
            status: 'Active',
            ownerId: owners[0].id,
        },
        {
            propertyId: 'prop-002',
            propertyName: 'Malibu Beach House',
            location: 'Malibu',
            state: 'California',
            country: 'USA',
            latitude: '34.0259',
            longitude: '-118.7798',
            guests: 6,
            bedrooms: 3,
            bathrooms: 2,
            kitchens: 1,
            nightlyRate: 550,
            weekendRate: 700,
            weeklyRate: 3500,
            monthlyRate: 12000,
            minRate: 450,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Swimming Pool', 'Air Conditioning', 'Kitchen', 'TV', 'Gym']),
            about: 'Stunning beach house on the Malibu coastline. Walking distance to the beach.',
            policyAndHouseRules: 'No smoking indoors, Pets allowed, Check-in after 2 PM',
            images: JSON.stringify([
                'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=800',
                'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800',
            ]),
            status: 'Active',
            ownerId: owners[1].id,
        },
        {
            propertyId: 'prop-003',
            propertyName: 'Aspen Mountain Lodge',
            location: 'Aspen',
            state: 'Colorado',
            country: 'USA',
            latitude: '39.1911',
            longitude: '-106.8175',
            guests: 4,
            bedrooms: 2,
            bathrooms: 1,
            kitchens: 1,
            nightlyRate: 400,
            weekendRate: 500,
            weeklyRate: 2500,
            monthlyRate: 9000,
            minRate: 350,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Kitchen', 'TV', 'Fireplace', 'Hot Tub']),
            about: 'Cozy mountain lodge with breathtaking Rocky Mountain views. Perfect for a ski retreat.',
            policyAndHouseRules: 'No parties, No smoking, Check-in after 1 PM',
            images: JSON.stringify([
                'https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800',
                'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800',
            ]),
            status: 'Active',
            ownerId: owners[2].id,
        },
        {
            propertyId: 'prop-004',
            propertyName: 'Downtown LA Penthouse',
            location: 'Los Angeles',
            state: 'California',
            country: 'USA',
            latitude: '34.0522',
            longitude: '-118.2437',
            guests: 10,
            bedrooms: 5,
            bathrooms: 4,
            kitchens: 2,
            nightlyRate: 800,
            weekendRate: 1000,
            weeklyRate: 5000,
            monthlyRate: 18000,
            minRate: 700,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Swimming Pool', 'Air Conditioning', 'Kitchen', 'TV', 'Gym']),
            about: 'Luxurious penthouse with city skyline views. Perfect for corporate events.',
            policyAndHouseRules: 'No smoking, No pets, Check-in after 4 PM',
            images: JSON.stringify([
                'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800',
                'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800',
            ]),
            status: 'Active',
            ownerId: owners[3].id,
        },
        {
            propertyId: 'prop-005',
            propertyName: 'Key West Beach Bungalow',
            location: 'Key West',
            state: 'Florida',
            country: 'USA',
            latitude: '24.5551',
            longitude: '-81.7800',
            guests: 4,
            bedrooms: 2,
            bathrooms: 2,
            kitchens: 1,
            nightlyRate: 350,
            weekendRate: 450,
            weeklyRate: 2200,
            monthlyRate: 8000,
            minRate: 300,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Air Conditioning', 'Kitchen', 'TV']),
            about: 'Charming Key West bungalow with tropical vibes. Steps from the beach.',
            policyAndHouseRules: 'No parties, Pets allowed, Check-in after 12 PM',
            images: JSON.stringify([
                'https://images.unsplash.com/photo-1507089947368-19c1da9775ae?w=800',
                'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800',
            ]),
            status: 'Pending',
            ownerId: owners[1].id,
        },
        {
            propertyId: 'prop-006',
            propertyName: 'Scottsdale Desert Estate',
            location: 'Scottsdale',
            state: 'Arizona',
            country: 'USA',
            latitude: '33.4942',
            longitude: '-111.9261',
            guests: 12,
            bedrooms: 6,
            bathrooms: 4,
            kitchens: 1,
            nightlyRate: 900,
            weekendRate: 1100,
            weeklyRate: 5500,
            monthlyRate: 20000,
            minRate: 800,
            amenities: JSON.stringify(['Wifi', 'Parking', 'Swimming Pool', 'Air Conditioning', 'Kitchen', 'TV']),
            about: 'Stunning desert estate with southwest architecture and modern luxuries.',
            policyAndHouseRules: 'No smoking, No pets, Check-in after 2 PM',
            images: JSON.stringify([
                'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800',
                'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800',
            ]),
            status: 'Active',
            ownerId: owners[2].id,
        },
    ];

    const createdProperties = [];
    for (const prop of properties) {
        const property = await prisma.property.upsert({
            where: { propertyId: prop.propertyId },
            update: {},
            create: prop,
        });
        createdProperties.push(property);
        console.log('✅ Created property:', property.propertyName);
    }

    // ============================================
    // 4. CREATE INQUIRIES
    // ============================================

    const inquiryData = [
        {
            propertyId: createdProperties[0].id,
            propertyName: createdProperties[0].propertyName,
            fullName: 'Chris Taylor',
            email: 'chris.taylor@gmail.com',
            phone: '5554567890',
            gender: 'Male',
            guests: 4,
            totalAmount: 1800,
            message: 'Looking forward to a family vacation. Is the pool heated?',
            checkin: new Date('2026-02-15'),
            checkout: new Date('2026-02-19'),
            nights: 4,
            status: 'PENDING',
        },
        {
            propertyId: createdProperties[1].id,
            propertyName: createdProperties[1].propertyName,
            fullName: 'Sarah Wilson',
            email: 'sarah.wilson@gmail.com',
            phone: '5556789012',
            gender: 'Female',
            guests: 2,
            totalAmount: 16000,
            message: 'Honeymoon trip! Any special arrangements possible?',
            checkin: new Date('2026-03-01'),
            checkout: new Date('2026-03-03'),
            nights: 2,
            status: 'ACCEPTED',
        },
        {
            propertyId: createdProperties[2].id,
            propertyName: createdProperties[2].propertyName,
            fullName: 'David Brown',
            email: 'david.brown@gmail.com',
            phone: '5551234568',
            gender: 'Male',
            guests: 3,
            totalAmount: 22000,
            message: 'Planning a week-long trip with friends. Is trekking guide available?',
            checkin: new Date('2026-04-10'),
            checkout: new Date('2026-04-17'),
            nights: 7,
            status: 'PENDING',
        },
        {
            propertyId: createdProperties[3].id,
            propertyName: createdProperties[3].propertyName,
            fullName: 'Jessica Martinez',
            email: 'jessica.martinez@gmail.com',
            phone: '5557890123',
            gender: 'Female',
            guests: 8,
            totalAmount: 5000,
            message: 'Corporate team outing for 2 nights.',
            checkin: new Date('2026-05-20'),
            checkout: new Date('2026-05-22'),
            nights: 2,
            status: 'BOOKED',
        },
        {
            propertyId: createdProperties[0].id,
            propertyName: createdProperties[0].propertyName,
            fullName: 'Jane Smith',
            email: 'user@mygatewayrentals.com',
            phone: '5551111111',
            gender: 'Female',
            guests: 6,
            totalAmount: 2700,
            message: 'Birthday celebration! Can we arrange a cake?',
            checkin: new Date('2026-06-01'),
            checkout: new Date('2026-06-07'),
            nights: 6,
            status: 'PENDING',
        },
        {
            propertyId: createdProperties[4].id,
            propertyName: createdProperties[4].propertyName,
            fullName: 'Ryan Miller',
            email: 'ryan.miller@gmail.com',
            phone: '5558901234',
            gender: 'Male',
            guests: 2,
            totalAmount: 10000,
            message: 'Weekend getaway with my wife.',
            checkin: new Date('2026-02-28'),
            checkout: new Date('2026-03-01'),
            nights: 2,
            status: 'REJECTED',
        },
        {
            propertyId: createdProperties[5].id,
            propertyName: createdProperties[5].propertyName,
            fullName: 'Ashley Thompson',
            email: 'ashley.thompson@gmail.com',
            phone: '5559012345',
            gender: 'Female',
            guests: 10,
            totalAmount: 6300,
            message: 'Destination wedding inquiry. Need the property for a week.',
            checkin: new Date('2026-11-15'),
            checkout: new Date('2026-11-22'),
            nights: 7,
            status: 'PENDING',
        },
        {
            propertyId: createdProperties[1].id,
            propertyName: createdProperties[1].propertyName,
            fullName: 'Robert Johnson',
            email: 'robert.johnson@gmail.com',
            phone: '5552223333',
            gender: 'Male',
            guests: 5,
            totalAmount: 40000,
            message: 'Family vacation during Christmas holidays.',
            checkin: new Date('2026-12-24'),
            checkout: new Date('2026-12-28'),
            nights: 4,
            status: 'PENDING',
        },
    ];

    for (let i = 0; i < inquiryData.length; i++) {
        const inquiry = await prisma.inquiry.create({
            data: {
                enquiryId: `INQ-2026-${String(i + 1).padStart(4, '0')}`,
                ...inquiryData[i],
                userId: endUsers[i % endUsers.length].id,
                propertyImages: createdProperties.find(p => p.id === inquiryData[i].propertyId)?.images,
            },
        });
        console.log('✅ Created inquiry:', inquiry.enquiryId, 'for', inquiry.propertyName);
    }

    // ============================================
    // 5. CREATE USER SUBSCRIPTIONS
    // ============================================

    const silverPlan = await prisma.subscriptionPlan.findUnique({ where: { id: 'silver' } });
    const goldPlan = await prisma.subscriptionPlan.findUnique({ where: { id: 'gold' } });
    const platinumPlan = await prisma.subscriptionPlan.findUnique({ where: { id: 'platinum' } });

    const subscriptions = [
        { userId: owners[0].id, planId: goldPlan.id, status: 'ACTIVE', months: 6 },
        { userId: owners[1].id, planId: platinumPlan.id, status: 'ACTIVE', months: 3 },
        { userId: owners[2].id, planId: silverPlan.id, status: 'EXPIRED', months: -1 },
        { userId: owners[3].id, planId: goldPlan.id, status: 'ACTIVE', months: 1 },
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
        console.log('✅ Created subscription for owner');
    }

    console.log('\n🎉 Comprehensive database seeding completed!');
    console.log('\n📋 Test Credentials:');
    console.log('   Admin: admin@mygatewayrentals.com / Admin@123');
    console.log('   Owner: owner@mygatewayrentals.com / Owner@123');
    console.log('   User:  user@mygatewayrentals.com / User@123');
    console.log('\n📊 Seeded Data Summary:');
    console.log('   - 1 Admin user');
    console.log('   - 4 Owner users');
    console.log('   - 5 End users');
    console.log('   - 4 Subscription plans');
    console.log('   - 6 Properties');
    console.log('   - 8 Inquiries');
    console.log('   - 4 User subscriptions');
}

main()
    .catch((e) => {
        console.error('❌ Seed error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
