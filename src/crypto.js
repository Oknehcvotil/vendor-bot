const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_SIZE = 12;

function deriveKey(secret) {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function encryptText(plainText, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_SIZE);
  const cipher = crypto.createCipheriv(ALGO, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptText(payload, secret) {
  const raw = Buffer.from(payload, "base64");
  const key = deriveKey(secret);
  const iv = raw.subarray(0, IV_SIZE);
  const tag = raw.subarray(IV_SIZE, IV_SIZE + 16);
  const encrypted = raw.subarray(IV_SIZE + 16);

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

module.exports = {
  encryptText,
  decryptText,
};
