CREATE TABLE "tasks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"status" varchar(32) DEFAULT 'todo' NOT NULL,
	"assignee_id" varchar(64),
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
