import { readFile } from 'node:fs/promises'
import { simpleParser } from 'mailparser'

/** Let the MIME parser decode each part using its declared charset/encoding. */
export async function parseEmailFile(filePath: string) {
  return simpleParser(await readFile(filePath))
}
