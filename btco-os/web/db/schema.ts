import {sqliteTable,text,integer,primaryKey,index} from 'drizzle-orm/sqlite-core';
export const vaultWorkspaces=sqliteTable('vault_workspaces',{
  ownerId:text('owner_id').primaryKey(),revision:integer('revision').notNull().default(0),
  manifest:text('manifest'),operationId:text('operation_id'),updatedAt:text('updated_at').notNull()
});
export const vaultChunks=sqliteTable('vault_chunks',{
  ownerId:text('owner_id').notNull(),hash:text('hash').notNull(),body:text('body').notNull(),createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.hash]})]);
export const vaultSnapshots=sqliteTable('vault_snapshots',{
  ownerId:text('owner_id').notNull(),revision:integer('revision').notNull(),manifest:text('manifest').notNull(),createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.revision]})]);
export const vaultDeviceBackups=sqliteTable('vault_device_backups',{
  ownerId:text('owner_id').notNull(),id:text('id').notNull(),label:text('label').notNull(),manifest:text('manifest').notNull(),createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.id]}),index('device_backup_owner_date').on(t.ownerId,t.createdAt)]);

// Separate from Vault: scans never create or mutate inventory without a reviewed save.
export const visionOperations=sqliteTable('vision_operations',{
  ownerId:text('owner_id').notNull(),id:text('id').notNull(),kind:text('kind').notNull(),
  day:text('day').notNull(),requestHash:text('request_hash').notNull(),status:text('status').notNull(),
  reservedMicros:integer('reserved_micros').notNull(),costMicros:integer('cost_micros'),
  inputTokens:integer('input_tokens'),outputTokens:integer('output_tokens'),result:text('result'),error:text('error'),
  createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.id]}),index('vision_owner_day').on(t.ownerId,t.day,t.kind)]);
export const visionPSACache=sqliteTable('vision_psa_cache',{
  ownerId:text('owner_id').notNull(),cert:text('cert').notNull(),result:text('result').notNull(),fetchedAt:text('fetched_at').notNull()
},t=>[primaryKey({columns:[t.ownerId,t.cert]})]);

// Encrypted provider credentials are isolated from portable Vault backups.
export const visionCredentials=sqliteTable('vision_credentials',{
  ownerId:text('owner_id').primaryKey(),encryptedToken:text('encrypted_token'),
  disabled:integer('disabled').notNull().default(0),verifiedAt:text('verified_at'),updatedAt:text('updated_at').notNull()
});
