ALTER TABLE "Creation" ADD COLUMN "isFavorite" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Creation_userId_isFavorite_createdAt_idx" ON "Creation"("userId", "isFavorite", "createdAt" DESC);
