-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'openid profile email';

-- CreateTable
CREATE TABLE "user_identities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_subject_key" ON "user_identities"("provider", "subject");
CREATE INDEX "user_identities_userId_idx" ON "user_identities"("userId");
