/**
 * RSA 密码加密工具
 * 使用 Web Crypto API 实现 RSA-OAEP 加密
 * 用于登录和注册时的密码安全传输
 */
let cachedPublicKey: CryptoKey | null = null
let cachedPublicKeyPem: string | null = null

async function importPublicKey(pem: string): Promise<CryptoKey> {
  if (cachedPublicKey && cachedPublicKeyPem === pem) {
    return cachedPublicKey
  }

  const pemContents = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '')
  
  const binaryKey = atob(pemContents)
  const keyBuffer = new Uint8Array(binaryKey.length)
  for (let i = 0; i < binaryKey.length; i++) {
    keyBuffer[i] = binaryKey.charCodeAt(i)
  }

  const key = await crypto.subtle.importKey(
    'spki',
    keyBuffer,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256'
    },
    false,
    ['encrypt']
  )

  cachedPublicKey = key
  cachedPublicKeyPem = pem
  return key
}

export async function encryptPassword(password: string): Promise<string> {
  const res = await fetch('/api/auth/public-key')
  if (!res.ok) {
    throw new Error('Failed to get public key')
  }
  const { publicKey: pem } = await res.json()

  const key = await importPublicKey(pem)
  
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'RSA-OAEP'
    },
    key,
    data
  )

  const encryptedArray = new Uint8Array(encryptedBuffer)
  let binary = ''
  for (let i = 0; i < encryptedArray.length; i++) {
    binary += String.fromCharCode(encryptedArray[i])
  }
  return btoa(binary)
}
