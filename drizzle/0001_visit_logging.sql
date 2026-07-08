ALTER TABLE `sites` ADD `origin` varchar(2048) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `host` varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `sites` SET `host` = SUBSTRING_INDEX(SUBSTRING_INDEX(`url`, '://', -1), '/', 1) WHERE `url` LIKE 'http%://%';--> statement-breakpoint
UPDATE `sites` SET `origin` = CONCAT(SUBSTRING_INDEX(`url`, '://', 1), '://', SUBSTRING_INDEX(SUBSTRING_INDEX(`url`, '://', -1), '/', 1)) WHERE `url` LIKE 'http%://%';--> statement-breakpoint
ALTER TABLE `sites` DROP COLUMN `title`;--> statement-breakpoint
ALTER TABLE `sites` DROP COLUMN `description`;--> statement-breakpoint
ALTER TABLE `sites` DROP COLUMN `keywords`;--> statement-breakpoint
DROP TABLE `site_visitors`;--> statement-breakpoint
CREATE TABLE `server_visits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp DEFAULT NULL,
	`visitor_id` int NOT NULL,
	`site_id` int NOT NULL,
	`kind` varchar(64) NOT NULL,
	`request_path` varchar(2048) NOT NULL DEFAULT '',
	`block_reason` varchar(255),
	`visit_token` varchar(64),
	`visited_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `server_visits_id` PRIMARY KEY(`id`),
	CONSTRAINT `server_visits_visit_token_unique` UNIQUE(`visit_token`)
);--> statement-breakpoint
CREATE TABLE `monetisation_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp DEFAULT NULL,
	`server_visit_id` int,
	`visit_token` varchar(64),
	`reported_at` timestamp NOT NULL DEFAULT (now()),
	`page_url` varchar(2048) NOT NULL DEFAULT '',
	`page_load_ms` int,
	`dom_content_loaded_ms` int,
	`images_scanned` int NOT NULL DEFAULT 0,
	`images_replaced` int NOT NULL DEFAULT 0,
	`backgrounds_replaced` int NOT NULL DEFAULT 0,
	`canvases_replaced` int NOT NULL DEFAULT 0,
	`skipped_already_monetised` int NOT NULL DEFAULT 0,
	`document_title` varchar(512),
	`viewport_w` int,
	`viewport_h` int,
	`client_script_version` varchar(64) NOT NULL DEFAULT '',
	`webdriver` boolean,
	CONSTRAINT `monetisation_reports_id` PRIMARY KEY(`id`)
);--> statement-breakpoint
ALTER TABLE `server_visits` ADD CONSTRAINT `server_visits_visitor_id_visitors_id_fk` FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `server_visits` ADD CONSTRAINT `server_visits_site_id_sites_id_fk` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `monetisation_reports` ADD CONSTRAINT `monetisation_reports_server_visit_id_server_visits_id_fk` FOREIGN KEY (`server_visit_id`) REFERENCES `server_visits`(`id`) ON DELETE no action ON UPDATE no action;
