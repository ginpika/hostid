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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_oauth_providers" ("authorizationUrl", "callbackUrl", "clientId", "clientSecret", "createdAt", "displayName", "id", "isActive", "provider", "tokenUrl", "updatedAt", "userinfoUrl") SELECT "authorizationUrl", "callbackUrl", "clientId", "clientSecret", "createdAt", "displayName", "id", "isActive", "provider", "tokenUrl", "updatedAt", "userinfoUrl" FROM "oauth_providers";
DROP TABLE "oauth_providers";
ALTER TABLE "new_oauth_providers" RENAME TO "oauth_providers";
CREATE UNIQUE INDEX "oauth_providers_provider_key" ON "oauth_providers"("provider");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
