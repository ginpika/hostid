/*
  Warnings:

  - You are about to drop the column `scope` on the `oauth_apps` table. All the data in the column will be lost.
  - You are about to drop the column `scope` on the `oauth_providers` table. All the data in the column will be lost.
  - You are about to drop the column `scope` on the `refresh_tokens` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_oauth_apps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "redirectUris" TEXT NOT NULL,
    "description" TEXT,
    "homepage" TEXT,
    "isConfidential" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "oauth_apps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_oauth_apps" ("clientId", "clientSecret", "createdAt", "description", "homepage", "id", "isActive", "isConfidential", "name", "redirectUris", "updatedAt", "userId") SELECT "clientId", "clientSecret", "createdAt", "description", "homepage", "id", "isActive", "isConfidential", "name", "redirectUris", "updatedAt", "userId" FROM "oauth_apps";
DROP TABLE "oauth_apps";
ALTER TABLE "new_oauth_apps" RENAME TO "oauth_apps";
CREATE UNIQUE INDEX "oauth_apps_clientId_key" ON "oauth_apps"("clientId");
CREATE TABLE "new_oauth_providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "callbackUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_oauth_providers" ("callbackUrl", "clientId", "clientSecret", "createdAt", "displayName", "id", "isActive", "provider", "updatedAt") SELECT "callbackUrl", "clientId", "clientSecret", "createdAt", "displayName", "id", "isActive", "provider", "updatedAt" FROM "oauth_providers";
DROP TABLE "oauth_providers";
ALTER TABLE "new_oauth_providers" RENAME TO "oauth_providers";
CREATE UNIQUE INDEX "oauth_providers_provider_key" ON "oauth_providers"("provider");
CREATE TABLE "new_refresh_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_refresh_tokens" ("clientId", "createdAt", "expiresAt", "id", "token", "userId") SELECT "clientId", "createdAt", "expiresAt", "id", "token", "userId" FROM "refresh_tokens";
DROP TABLE "refresh_tokens";
ALTER TABLE "new_refresh_tokens" RENAME TO "refresh_tokens";
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
