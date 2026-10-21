CREATE TABLE `vault_chunks` (
	`owner_id` text NOT NULL,
	`hash` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `hash`)
);
--> statement-breakpoint
CREATE TABLE `vault_device_backups` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`label` text NOT NULL,
	`manifest` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `device_backup_owner_date` ON `vault_device_backups` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `vault_snapshots` (
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`manifest` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `vault_workspaces` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`manifest` text,
	`operation_id` text,
	`updated_at` text NOT NULL
);
