CREATE TABLE `outbox` (
	`task_id` text PRIMARY KEY NOT NULL,
	`queued_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `clocks` text DEFAULT '{}' NOT NULL;