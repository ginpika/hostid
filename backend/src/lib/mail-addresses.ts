/**
 * 邮件地址提取
 * mailparser 的 from/to/cc/bcc 可能是单个对象或数组；EML 导入与 SMTP 入站共用这一份展开逻辑。
 */
import type { AddressObject } from 'mailparser'

export interface ParsedAddress {
  address: string
  name: string | null
}

export function extractAddresses(
  field: AddressObject | AddressObject[] | undefined,
  options: { lowercase?: boolean } = {}
): ParsedAddress[] {
  if (!field) return []
  const objects = Array.isArray(field) ? field : [field]

  return objects
    .flatMap(object => object.value ?? [])
    .filter((entry): entry is typeof entry & { address: string } => !!entry.address)
    .map(entry => ({
      address: options.lowercase ? entry.address.toLowerCase() : entry.address,
      name: entry.name || null
    }))
}
