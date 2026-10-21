CREATE TABLE `vision_operations` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`day` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text NOT NULL,
	`reserved_micros` integer NOT NULL,
	`cost_micros` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`result` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `vision_owner_day` ON `vision_operations` (`owner_id`,`day`,`kind`);--> statement-breakpoint
CREATE TABLE `vision_psa_cache` (
	`owner_id` text NOT NULL,
	`cert` text NOT NULL,
	`result` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `cert`)
);
