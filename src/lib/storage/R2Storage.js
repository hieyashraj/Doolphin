// Assuming aws-sdk v3 is used
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

class R2Storage {
  constructor() {
    this.client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      }
    });
    this.bucketName = process.env.R2_BUCKET_NAME;
  }

  async getPresignedUploadUrl(objectKey, contentType = 'video/mp4', expiresIn = 3600) {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: objectKey,
      ContentType: contentType,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn });
    return url;
  }
}

module.exports = new R2Storage();
