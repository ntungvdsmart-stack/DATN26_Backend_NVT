const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const filename = require.resolve('cloudinary');
let providerError = false;
require.cache[filename] = { id: filename, filename, loaded: true, exports: { v2: {
  config() {},
  uploader: {
    upload_stream(options, callback) {
      assert.equal(options.resource_type, 'image');
      let size = 0;
      return new Writable({ write(chunk, encoding, next) { size += chunk.length; next(); }, final(next) { callback(providerError ? new Error('Provider unavailable') : null, providerError ? null : { secure_url: 'https://res.cloudinary.com/test/image/upload/image.png', public_id: options.public_id, bytes: size }); next(); } });
    },
    destroy(id, callback) { callback(null); }
  }
} } };
const upload = require('../src/middlewares/uploadMiddleware');
test('upload streams bytes to the provider and returns actual asset metadata', async () => {
  providerError = false;
  const file = { stream: Readable.from([Buffer.from('test-image')]) };
  const result = await new Promise((resolve, reject) => upload.storage._handleFile({}, file, (error, result) => error ? reject(error) : resolve(result)));
  assert.equal(result.size, 10);
  assert.ok(result.path.startsWith('https://res.cloudinary.com/'));
});
test('provider failures propagate instead of returning a placeholder success', async () => {
  providerError = true;
  await assert.rejects(new Promise((resolve, reject) => upload.storage._handleFile({}, { stream: Readable.from(['invalid']) }, (error, result) => error ? reject(error) : resolve(result))), error => error.statusCode === 502);
});
test('upload rejects non-image MIME types before contacting the provider', async () => {
  await assert.rejects(new Promise((resolve, reject) => upload.fileFilter({}, { mimetype: 'text/plain' }, error => error ? reject(error) : resolve())), error => error.statusCode === 400);
});
