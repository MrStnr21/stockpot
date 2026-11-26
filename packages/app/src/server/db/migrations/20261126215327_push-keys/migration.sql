CREATE TABLE `push_keys` (
	`id` integer PRIMARY KEY,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "push_keys_single_row" CHECK("id" = 1)
);
--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD `locale` text DEFAULT 'en' NOT NULL;