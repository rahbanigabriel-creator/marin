-- Keep the database default aligned with Prisma and fail closed before a
-- signature-verified Stripe subscription event establishes paid state.

ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'inactive';
