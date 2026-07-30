// Manual Jest mock for file-type (ESM-only package)
// In tests, we stub it to always report a valid JPEG so upload validation passes.
// Individual tests can override this if needed via jest.spyOn.
module.exports = {
    fileTypeFromFile: jest.fn().mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' }),
};
