-- 融合邮件（Fused Mail）
-- 1. oauth_providers 增加用途配置：useForLogin（默认 true，已有 provider 只勾登录）、useForFusedMail（默认 false）
--    以及 mailPlatform / fusedMailCallbackUrl
-- 2. 新增 fused_mail_accounts（按 userId + platform + email 唯一）与 fused_emails
-- 注意：本迁移刻意不包含历史遗留的 SSOApp 表漂移（prisma diff 会建议 DROP，这里不做破坏性操作）

-- CreateTable
CREATE TABLE "fused_mail_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "providerId" TEXT,
    "platform" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastError" TEXT,
    "lastSyncedAt" DATETIME,
    "uidValidity" TEXT,
    "lastUid" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "fused_mail_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fused_mail_accounts_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "oauth_providers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fused_emails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "uidValidity" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "messageId" TEXT,
    "from" TEXT NOT NULL,
    "fromName" TEXT,
    "to" TEXT NOT NULL,
    "toList" TEXT NOT NULL DEFAULT '[]',
    "ccList" TEXT DEFAULT '[]',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "summary" TEXT,
    "folder" TEXT NOT NULL DEFAULT 'INBOX',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "fused_emails_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fused_mail_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_oauth_providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "callbackUrl" TEXT NOT NULL,
    "authorizationUrl" TEXT NOT NULL DEFAULT 'https://github.com/login/oauth/authorize',
    "tokenUrl" TEXT NOT NULL DEFAULT 'https://github.com/login/oauth/access_token',
    "userinfoUrl" TEXT NOT NULL DEFAULT 'https://api.github.com/user',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "useForLogin" BOOLEAN NOT NULL DEFAULT true,
    "useForFusedMail" BOOLEAN NOT NULL DEFAULT false,
    "mailPlatform" TEXT,
    "fusedMailCallbackUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_oauth_providers" ("authorizationUrl", "callbackUrl", "clientId", "clientSecret", "createdAt", "displayName", "id", "isActive", "provider", "tokenUrl", "updatedAt", "userinfoUrl") SELECT "authorizationUrl", "callbackUrl", "clientId", "clientSecret", "createdAt", "displayName", "id", "isActive", "provider", "tokenUrl", "updatedAt", "userinfoUrl" FROM "oauth_providers";
DROP TABLE "oauth_providers";
ALTER TABLE "new_oauth_providers" RENAME TO "oauth_providers";
CREATE UNIQUE INDEX "oauth_providers_provider_key" ON "oauth_providers"("provider");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "fused_mail_accounts_userId_idx" ON "fused_mail_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "fused_mail_accounts_userId_platform_email_key" ON "fused_mail_accounts"("userId", "platform", "email");

-- CreateIndex
CREATE INDEX "fused_emails_accountId_createdAt_idx" ON "fused_emails"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "fused_emails_accountId_uidValidity_uid_key" ON "fused_emails"("accountId", "uidValidity", "uid");

