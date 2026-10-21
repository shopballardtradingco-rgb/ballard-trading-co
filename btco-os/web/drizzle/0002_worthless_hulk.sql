CREATE TABLE `vision_credentials` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`encrypted_token` text,
	`disabled` integer DEFAULT 0 NOT NULL,
	`verified_at` text,
	`updated_at` text NOT NULL
);
