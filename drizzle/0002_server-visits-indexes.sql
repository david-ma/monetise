CREATE INDEX `monetisation_reports_reported_at_idx` ON `monetisation_reports` (`reported_at`);--> statement-breakpoint
CREATE INDEX `server_visits_visited_at_idx` ON `server_visits` (`visited_at`);--> statement-breakpoint
CREATE INDEX `server_visits_visitor_visited_idx` ON `server_visits` (`visitor_id`,`visited_at`);