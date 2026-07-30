// Jest mock for uuid (v13 is ESM-only)
const { v4 } = require('crypto');
module.exports = {
    v4: () => require('crypto').randomUUID(),
};
