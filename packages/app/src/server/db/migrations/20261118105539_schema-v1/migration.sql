CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY,
	`endpoint` text NOT NULL UNIQUE,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `engine_runs` (
	`id` integer PRIMARY KEY,
	`job_id` integer,
	`engine` text NOT NULL,
	`model` text,
	`task` text NOT NULL,
	`outcome` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`searches` integer,
	`cost_usd` real,
	CONSTRAINT `fk_engine_runs_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY,
	`kind` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`run_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `digest_items` (
	`digest_id` integer NOT NULL,
	`note_id` integer NOT NULL,
	`position` integer NOT NULL,
	`action` text,
	`acted_at` integer,
	CONSTRAINT `digest_items_pk` PRIMARY KEY(`digest_id`, `note_id`),
	CONSTRAINT `fk_digest_items_digest_id_digests_id_fk` FOREIGN KEY (`digest_id`) REFERENCES `digests`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_digest_items_note_id_notes_id_fk` FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `digests` (
	`id` integer PRIMARY KEY,
	`day` text NOT NULL UNIQUE,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`opened_at` integer
);
--> statement-breakpoint
CREATE TABLE `aliases` (
	`alias` text NOT NULL,
	`term_id` integer NOT NULL,
	CONSTRAINT `aliases_pk` PRIMARY KEY(`alias`, `term_id`),
	CONSTRAINT `fk_aliases_term_id_terms_id_fk` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY,
	`name` text NOT NULL UNIQUE,
	`icon` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`format` text NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY,
	`text` text NOT NULL,
	`context` text,
	`url` text,
	`source` text DEFAULT 'web' NOT NULL,
	`category_id` integer,
	`term_id` integer,
	`tags` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`is_private` integer DEFAULT false NOT NULL,
	`first_shown_at` integer,
	`expires_at` integer,
	`kept_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_notes_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_notes_term_id_terms_id_fk` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `terms` (
	`id` integer PRIMARY KEY,
	`term` text NOT NULL,
	`meaning` text DEFAULT '' NOT NULL,
	`category_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_terms_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `explanations` (
	`id` integer PRIMARY KEY,
	`note_id` integer,
	`term_id` integer,
	`format` text NOT NULL,
	`depth` integer DEFAULT 1 NOT NULL,
	`language` text NOT NULL,
	`body` text NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`is_uncertain` integer DEFAULT false NOT NULL,
	`is_draft` integer DEFAULT false NOT NULL,
	`engine` text NOT NULL,
	`model` text,
	`prompt_version` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_explanations_note_id_notes_id_fk` FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_explanations_term_id_terms_id_fk` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL,
	CONSTRAINT "explanations_subject" CHECK("note_id" is not null or "term_id" is not null)
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` integer PRIMARY KEY,
	`name` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE TABLE `owner` (
	`id` integer PRIMARY KEY,
	`password_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "owner_single_row" CHECK("id" = 1)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `engine_runs_engine_started_at_idx` ON `engine_runs` (`engine`,`started_at`);--> statement-breakpoint
CREATE INDEX `engine_runs_job_id_idx` ON `engine_runs` (`job_id`);--> statement-breakpoint
CREATE INDEX `jobs_queue_idx` ON `jobs` (`status`,"priority" desc,`run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `digest_items_digest_id_position_idx` ON `digest_items` (`digest_id`,`position`);--> statement-breakpoint
CREATE INDEX `digest_items_note_id_idx` ON `digest_items` (`note_id`);--> statement-breakpoint
CREATE INDEX `aliases_term_id_idx` ON `aliases` (`term_id`);--> statement-breakpoint
CREATE INDEX `notes_created_at_idx` ON `notes` (`created_at`);--> statement-breakpoint
CREATE INDEX `notes_status_created_at_idx` ON `notes` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `notes_category_id_created_at_idx` ON `notes` (`category_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notes_term_id_idx` ON `notes` (`term_id`);--> statement-breakpoint
CREATE INDEX `notes_kept_at_idx` ON `notes` (`kept_at`) WHERE "notes"."kept_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `terms_term_meaning_idx` ON `terms` (`term`,`meaning`);--> statement-breakpoint
CREATE INDEX `terms_category_id_idx` ON `terms` (`category_id`);--> statement-breakpoint
CREATE INDEX `explanations_note_id_created_at_idx` ON `explanations` (`note_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `explanations_term_id_idx` ON `explanations` (`term_id`);
--> statement-breakpoint
/* Hand-written from here on: drizzle-kit does not model FTS5 tables, views or triggers (README.md).
 * note_search holds one row per note, keyed by the note's id: its text, its context and the text of
 * its cards. The prefix indexes keep search-as-you-type on the index. */
CREATE VIRTUAL TABLE `note_search` USING fts5(
	`text`,
	`context`,
	`cards`,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
--> statement-breakpoint
/* The string values in a note's card bodies, without the JSON keys that every card of a format shares. */
CREATE VIEW `note_card_text` AS
	SELECT `explanations`.`note_id`, group_concat(`body_value`.`value`, ' ') AS `cards`
	FROM `explanations`, json_tree(`explanations`.`body`) AS `body_value`
	WHERE `explanations`.`note_id` IS NOT NULL AND `body_value`.`type` = 'text'
	GROUP BY `explanations`.`note_id`;
--> statement-breakpoint
CREATE TRIGGER `notes_search_insert` AFTER INSERT ON `notes` BEGIN
	INSERT INTO `note_search` (`rowid`, `text`, `context`, `cards`)
	VALUES (new.`id`, new.`text`, new.`context`, '');
END;
--> statement-breakpoint
CREATE TRIGGER `notes_search_update` AFTER UPDATE OF `text`, `context` ON `notes` BEGIN
	UPDATE `note_search` SET `text` = new.`text`, `context` = new.`context` WHERE `rowid` = new.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `notes_search_delete` AFTER DELETE ON `notes` BEGIN
	DELETE FROM `note_search` WHERE `rowid` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `explanations_search_insert` AFTER INSERT ON `explanations` BEGIN
	UPDATE `note_search`
	SET `cards` = coalesce((SELECT `cards` FROM `note_card_text` WHERE `note_id` = new.`note_id`), '')
	WHERE `rowid` = new.`note_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `explanations_search_update` AFTER UPDATE OF `note_id`, `body` ON `explanations` BEGIN
	UPDATE `note_search`
	SET `cards` = coalesce((SELECT `cards` FROM `note_card_text` WHERE `note_id` = old.`note_id`), '')
	WHERE `rowid` = old.`note_id`;
	UPDATE `note_search`
	SET `cards` = coalesce((SELECT `cards` FROM `note_card_text` WHERE `note_id` = new.`note_id`), '')
	WHERE `rowid` = new.`note_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `explanations_search_delete` AFTER DELETE ON `explanations` BEGIN
	UPDATE `note_search`
	SET `cards` = coalesce((SELECT `cards` FROM `note_card_text` WHERE `note_id` = old.`note_id`), '')
	WHERE `rowid` = old.`note_id`;
END;
--> statement-breakpoint
/* A card written for a term alone goes with its term. The foreign key would set its term_id to NULL,
 * which the explanations_subject check rejects, so the term could never be deleted. Cards that also
 * belong to a note keep the note and lose only the term. */
CREATE TRIGGER `terms_delete_cards` BEFORE DELETE ON `terms` BEGIN
	DELETE FROM `explanations` WHERE `term_id` = old.`id` AND `note_id` IS NULL;
END;