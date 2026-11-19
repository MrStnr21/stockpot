CREATE TABLE `browsers` (
	`token_hash` text PRIMARY KEY,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer NOT NULL
);
