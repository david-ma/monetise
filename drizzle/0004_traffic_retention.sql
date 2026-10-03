CREATE TABLE `traffic_daily_summaries` (
	`day` date NOT NULL,
	`kind` varchar(64) NOT NULL,
	`visits` bigint unsigned NOT NULL DEFAULT 0,
	`reports` bigint unsigned NOT NULL DEFAULT 0,
	`images_scanned` bigint unsigned NOT NULL DEFAULT 0,
	`images_replaced` bigint unsigned NOT NULL DEFAULT 0,
	`backgrounds_replaced` bigint unsigned NOT NULL DEFAULT 0,
	`canvases_replaced` bigint unsigned NOT NULL DEFAULT 0,
	`skipped_already_monetised` bigint unsigned NOT NULL DEFAULT 0,
	`page_load_ms_sum` bigint unsigned NOT NULL DEFAULT 0,
	`page_load_samples` bigint unsigned NOT NULL DEFAULT 0,
	`dom_content_loaded_ms_sum` bigint unsigned NOT NULL DEFAULT 0,
	`dom_content_loaded_samples` bigint unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `traffic_daily_summaries_day_kind_pk` PRIMARY KEY(`day`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `traffic_retention_cursors` (
	`table_name` varchar(32) NOT NULL,
	`last_id` int NOT NULL DEFAULT 0,
	CONSTRAINT `traffic_retention_cursors_table_name` PRIMARY KEY(`table_name`)
);
