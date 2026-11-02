/**
 * 融合邮件 SMTP 发信（实验性）
 * 使用 nodemailer 的 OAuth2（XOAUTH2）认证从融合账号发信。
 * 注意：Outlook 发信还需要 https://outlook.office.com/SMTP.Send scope（当前默认 scope 未包含），
 * Gmail 的 https://mail.google.com/ 已覆盖 SMTP。前端暂未接入。
 */
import nodemailer from 'nodemailer'
import { prisma } from '../../lib/prisma'
import { PLATFORMS, isMailPlatform } from './platforms'
import { getValidAccessToken } from './tokenStore'

export interface FusedSendInput {
  to: string[]
  cc?: string[]
  subject: string
  html: string
}

export async function sendViaFusedAccount(userId: string, accountId: string, input: FusedSendInput) {
  const account = await prisma.fusedMailAccount.findFirst({ where: { id: accountId, userId } })
  if (!account || !isMailPlatform(account.platform)) throw new Error('Account not found')
  const accessToken = await getValidAccessToken(account.id)
  const { host, port, secure } = PLATFORMS[account.platform].smtp
  const transport = nodemailer.createTransport({ host, port, secure, auth: { type: 'OAuth2', user: account.email, accessToken } })
  return transport.sendMail({ from: account.email, to: input.to, cc: input.cc, subject: input.subject, html: input.html })
}
