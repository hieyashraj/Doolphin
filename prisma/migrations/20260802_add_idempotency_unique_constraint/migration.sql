-- CreateIndex for atomic uniqueness on (userId, idempotencyKey)
CREATE UNIQUE INDEX IF NOT EXISTS "Creation_userId_idempotencyKey_key" ON "Creation"("userId", "idempotencyKey");
