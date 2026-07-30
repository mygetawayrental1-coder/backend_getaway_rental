// Jest mock for sharp (native binary, not needed in tests)
module.exports = jest.fn().mockReturnValue({
    rotate: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    gif: jest.fn().mockReturnThis(),
    toFile: jest.fn().mockResolvedValue({}),
});
