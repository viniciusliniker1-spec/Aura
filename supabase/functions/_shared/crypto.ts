// AES-256-GCM. A chave é derivada (SHA-256) do secret VAULT_MASTER_KEY — qualquer string forte serve.
async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('VAULT_MASTER_KEY');
  if (!raw || raw.length < 16) {
    throw new Error('VAULT_MASTER_KEY ausente ou curta demais (use: openssl rand -hex 32)');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function encryptSecret(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), new TextEncoder().encode(plain));
  return { encrypted: toB64(cipher), iv: toB64(iv) };
}

export async function decryptSecret(encryptedB64: string, ivB64: string): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, await getKey(), fromB64(encryptedB64));
  return new TextDecoder().decode(plain);
}
