-- PostgreSQL truncates the generated identifier differently from Prisma's
-- expected name. Use one short explicit name to keep schema drift at zero.

ALTER INDEX "channel_accounts_integration_id_platform_external_account_id_ke"
  RENAME TO "channel_accounts_identity_key";
