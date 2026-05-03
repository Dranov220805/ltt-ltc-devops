const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');

/**
 * S3 is enabled when S3_BUCKET is set (e.g. EKS + IRSA; local dev usually leaves it unset).
 */
function s3Enabled() {
  return Boolean(String(process.env.S3_BUCKET || '').trim());
}

function getClient() {
  return new S3Client({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-southeast-1'
  });
}

function objectKeyForFilename(filename) {
  const prefix = String(process.env.S3_KEY_PREFIX || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const base = `uploads/${filename}`;
  return prefix ? `${prefix}/${base}` : base;
}

/**
 * @param {string} imageUrl � stored form e.g. /uploads/123-photo.jpg
 * @returns {string|null} S3 object key
 */
function keyFromImageUrl(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('/uploads/')) return null;
  const name = imageUrl.replace(/^\/uploads\//, '');
  if (!name || name.includes('..')) return null;
  return objectKeyForFilename(name);
}

/**
 * @param {string} filename � basename under uploads/
 * @param {Buffer} body
 * @param {string} [contentType]
 */
async function putUpload(filename, body, contentType) {
  const bucket = String(process.env.S3_BUCKET || '').trim();
  if (!bucket) throw new Error('S3_BUCKET is not set');
  const key = objectKeyForFilename(filename);
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream'
    })
  );
}

/**
 * @param {string} imageUrl /uploads/...
 */
async function deleteUpload(imageUrl) {
  if (!s3Enabled()) return;
  const key = keyFromImageUrl(imageUrl);
  if (!key) return;
  const bucket = String(process.env.S3_BUCKET || '').trim();
  const client = getClient();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );
}

/**
 * @param {string} filename basename (no path traversal)
 * @param {import('express').Response} res
 */
async function streamUploadToResponse(filename, res) {
  const bucket = String(process.env.S3_BUCKET || '').trim();
  if (!bucket) {
    res.status(500).send('S3 not configured');
    return;
  }
  const key = objectKeyForFilename(filename);
  const client = getClient();
  let out;
  try {
    out = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );
  } catch (err) {
    if (err && err.name === 'NoSuchKey') {
      res.status(404).send('Not found');
      return;
    }
    throw err;
  }
  const ct = out.ContentType || 'application/octet-stream';
  res.setHeader('Content-Type', ct);
  if (out.CacheControl) res.setHeader('Cache-Control', out.CacheControl);
  out.Body.pipe(res);
}

module.exports = {
  s3Enabled,
  getClient,
  objectKeyForFilename,
  keyFromImageUrl,
  putUpload,
  deleteUpload,
  streamUploadToResponse
};
