import crypto from 'crypto'

let publicKey: string
let privateKey: string

export function initRSAKeys() {
  if (!publicKey || !privateKey) {
    const { publicKey: pub, privateKey: priv } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    })
    publicKey = pub
    privateKey = priv
  }
}

export function getPublicKey(): string {
  initRSAKeys()
  return publicKey
}

export function decryptPassword(encryptedPassword: string): string {
  initRSAKeys()
  try {
    const buffer = Buffer.from(encryptedPassword, 'base64')
    const decrypted = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      buffer
    )
    return decrypted.toString('utf8')
  } catch (error) {
    throw new Error('Failed to decrypt password')
  }
}
