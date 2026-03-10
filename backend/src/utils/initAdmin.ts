import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const generateRandomPassword = (length: number = 16): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  let password = ''
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

const logAdminCredentials = (username: string, password: string): void => {
  const logDir = path.join(__dirname, '../../logs')
  const logFile = path.join(logDir, 'admin-credentials.log')
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  
  const timestamp = new Date().toISOString()
  const logEntry = `[${timestamp}] ${username}: ${password}\n`
  
  fs.appendFileSync(logFile, logEntry, { mode: 0o600 })
}

export const initAdminUsers = async (): Promise<void> => {
  const adminUsers = [
    { username: 'root', role: 'root' },
    { username: 'admin', role: 'admin' }
  ]

  const mailDomain = process.env.MAIL_DOMAIN || 'localhost'

  for (const adminUser of adminUsers) {
    const existingUser = await prisma.user.findUnique({
      where: { username: adminUser.username }
    })

    if (!existingUser) {
      const password = generateRandomPassword()
      const hashedPassword = await bcrypt.hash(password, 10)
      const email = `${adminUser.username}@${mailDomain}`
      
      await prisma.user.create({
        data: {
          email,
          username: adminUser.username,
          password: hashedPassword,
          role: adminUser.role
        }
      })
      
      logAdminCredentials(adminUser.username, password)
      console.log(`[Init] Created ${adminUser.role} user: ${adminUser.username}`)
    }
  }
}
