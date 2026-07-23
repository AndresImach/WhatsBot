import crypto from "node:crypto";

function claveCrypto() {
  const raw = process.env.CRM_CRYPTO_KEY || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CRM_CRYPTO_KEY debe contener exactamente 32 bytes codificados en base64.");
  return key;
}

export function cifrarSecreto(valor) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", claveCrypto(), iv);
  const cifrado = Buffer.concat([cipher.update(String(valor), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), cifrado.toString("base64url")].join(".");
}

export function descifrarSecreto(payload) {
  const [version, ivRaw, tagRaw, dataRaw] = String(payload || "").split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !dataRaw) throw new Error("Secreto cifrado inválido.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", claveCrypto(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]).toString("utf8");
}

export function generarApiKey() {
  const key = `wbk_${crypto.randomBytes(32).toString("base64url")}`;
  return { key, hash: hashApiKey(key), suffix: key.slice(-6) };
}

export function hashApiKey(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex");
}
