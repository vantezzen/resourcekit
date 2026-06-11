CREATE TABLE "issues" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"project_id" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"assignee_id" varchar(64),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
