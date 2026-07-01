CREATE TABLE `sites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp DEFAULT NULL,
	`url` varchar(2048) NOT NULL,
	`title` varchar(255) NOT NULL DEFAULT 'title',
	`description` text NOT NULL,
	`keywords` text NOT NULL,
	CONSTRAINT `sites_id` PRIMARY KEY(`id`),
	CONSTRAINT `sites_url_unique` UNIQUE(`url`)
);
--> statement-breakpoint
CREATE TABLE `visitors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp DEFAULT NULL,
	`ip` varchar(64) NOT NULL,
	`user_agent` text NOT NULL DEFAULT (''),
	CONSTRAINT `visitors_id` PRIMARY KEY(`id`),
	CONSTRAINT `visitors_ip_unique` UNIQUE(`ip`)
);
--> statement-breakpoint
CREATE TABLE `site_visitors` (
	`site_id` int NOT NULL,
	`visitor_id` int NOT NULL,
	CONSTRAINT `site_visitors_site_id_visitor_id_pk` PRIMARY KEY(`site_id`,`visitor_id`)
);
--> statement-breakpoint
CREATE TABLE `paintings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp DEFAULT NULL,
	`title` varchar(512) NOT NULL,
	`year_start` int,
	`year_end` int,
	`url` text,
	`image_key` varchar(255),
	`filename` varchar(512),
	CONSTRAINT `paintings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `site_visitors` ADD CONSTRAINT `site_visitors_site_id_sites_id_fk` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `site_visitors` ADD CONSTRAINT `site_visitors_visitor_id_visitors_id_fk` FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON DELETE no action ON UPDATE no action;
