-- CreateTable
CREATE TABLE "pm_projects" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "customer_id" TEXT,
    "manager_id" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "budget" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "estimated_cost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'planning',
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pm_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_project_members" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "parent_task_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee_id" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "start_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "estimated_hours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "actual_hours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_task_dependencies" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "depends_on_task_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'finish_to_start',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_task_checklist_items" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "is_done" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_task_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_task_comments" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_milestones" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "target_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pm_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_time_entries" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT,
    "user_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_minutes" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "is_running" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_project_attachments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_project_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_project_activities" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_project_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_project_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "default_statuses" JSONB,
    "default_priorities" JSONB,
    "custom_fields" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pm_project_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mtg_meetings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "meeting_type" TEXT NOT NULL DEFAULT 'internal',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "location" TEXT,
    "meeting_link" TEXT,
    "organizer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "agenda_summary" TEXT,
    "minutes_summary" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mtg_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mtg_participants" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "user_id" TEXT,
    "guest_name" TEXT,
    "guest_email" TEXT,
    "response" TEXT NOT NULL DEFAULT 'pending',
    "attended" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mtg_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mtg_agenda_items" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "presenter_id" TEXT,
    "allocated_minutes" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mtg_agenda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mtg_minutes" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "decisions" TEXT,
    "recorded_by" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mtg_minutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mtg_action_items" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assignee_id" TEXT,
    "due_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "linked_task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mtg_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mtg_attachments" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mtg_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mtg_activities" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mtg_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ntc_notices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publish_at" TIMESTAMP(3),
    "expire_at" TIMESTAMP(3),
    "allow_comments" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ntc_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ntc_categories" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ntc_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ntc_audiences" (
    "id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "audience_type" TEXT NOT NULL DEFAULT 'company',
    "audience_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ntc_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ntc_read_receipts" (
    "id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ntc_read_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ntc_comments" (
    "id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ntc_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ntc_attachments" (
    "id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ntc_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ntc_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "require_approval" BOOLEAN NOT NULL DEFAULT false,
    "notify_on_publish" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ntc_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appt_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appt_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appt_services" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "price" DECIMAL(15,2),
    "type_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appt_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appt_service_assignees" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appt_service_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appt_availability" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_break" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appt_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appt_holidays" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appt_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appt_bookings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "service_id" TEXT,
    "type_id" TEXT,
    "user_id" TEXT,
    "customer_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT,
    "customer_phone" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "location" TEXT,
    "meeting_link" TEXT,
    "notes" TEXT,
    "public_token" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appt_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appt_booking_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "slot_interval_minutes" INTEGER NOT NULL DEFAULT 30,
    "require_approval" BOOLEAN NOT NULL DEFAULT false,
    "public_slug" TEXT,
    "public_enabled" BOOLEAN NOT NULL DEFAULT false,
    "reminder_minutes_before" INTEGER NOT NULL DEFAULT 60,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appt_booking_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appt_activities" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appt_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pm_projects_company_id_idx" ON "pm_projects"("company_id");

-- CreateIndex
CREATE INDEX "pm_projects_company_id_status_idx" ON "pm_projects"("company_id", "status");

-- CreateIndex
CREATE INDEX "pm_projects_company_id_is_archived_idx" ON "pm_projects"("company_id", "is_archived");

-- CreateIndex
CREATE INDEX "pm_projects_manager_id_idx" ON "pm_projects"("manager_id");

-- CreateIndex
CREATE INDEX "pm_projects_customer_id_idx" ON "pm_projects"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "pm_projects_company_id_project_code_key" ON "pm_projects"("company_id", "project_code");

-- CreateIndex
CREATE INDEX "pm_project_members_user_id_idx" ON "pm_project_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "pm_project_members_project_id_user_id_key" ON "pm_project_members"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "pm_tasks_project_id_idx" ON "pm_tasks"("project_id");

-- CreateIndex
CREATE INDEX "pm_tasks_project_id_status_idx" ON "pm_tasks"("project_id", "status");

-- CreateIndex
CREATE INDEX "pm_tasks_assignee_id_idx" ON "pm_tasks"("assignee_id");

-- CreateIndex
CREATE INDEX "pm_tasks_parent_task_id_idx" ON "pm_tasks"("parent_task_id");

-- CreateIndex
CREATE INDEX "pm_tasks_due_date_idx" ON "pm_tasks"("due_date");

-- CreateIndex
CREATE INDEX "pm_task_dependencies_depends_on_task_id_idx" ON "pm_task_dependencies"("depends_on_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "pm_task_dependencies_task_id_depends_on_task_id_key" ON "pm_task_dependencies"("task_id", "depends_on_task_id");

-- CreateIndex
CREATE INDEX "pm_task_checklist_items_task_id_idx" ON "pm_task_checklist_items"("task_id");

-- CreateIndex
CREATE INDEX "pm_task_comments_task_id_idx" ON "pm_task_comments"("task_id");

-- CreateIndex
CREATE INDEX "pm_task_comments_user_id_idx" ON "pm_task_comments"("user_id");

-- CreateIndex
CREATE INDEX "pm_milestones_project_id_idx" ON "pm_milestones"("project_id");

-- CreateIndex
CREATE INDEX "pm_milestones_target_date_idx" ON "pm_milestones"("target_date");

-- CreateIndex
CREATE INDEX "pm_time_entries_project_id_idx" ON "pm_time_entries"("project_id");

-- CreateIndex
CREATE INDEX "pm_time_entries_task_id_idx" ON "pm_time_entries"("task_id");

-- CreateIndex
CREATE INDEX "pm_time_entries_user_id_idx" ON "pm_time_entries"("user_id");

-- CreateIndex
CREATE INDEX "pm_time_entries_user_id_is_running_idx" ON "pm_time_entries"("user_id", "is_running");

-- CreateIndex
CREATE INDEX "pm_project_attachments_project_id_idx" ON "pm_project_attachments"("project_id");

-- CreateIndex
CREATE INDEX "pm_project_attachments_task_id_idx" ON "pm_project_attachments"("task_id");

-- CreateIndex
CREATE INDEX "pm_project_activities_project_id_created_at_idx" ON "pm_project_activities"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "pm_project_activities_task_id_idx" ON "pm_project_activities"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "pm_project_settings_company_id_key" ON "pm_project_settings"("company_id");

-- CreateIndex
CREATE INDEX "mtg_meetings_company_id_idx" ON "mtg_meetings"("company_id");

-- CreateIndex
CREATE INDEX "mtg_meetings_company_id_starts_at_idx" ON "mtg_meetings"("company_id", "starts_at");

-- CreateIndex
CREATE INDEX "mtg_meetings_company_id_status_idx" ON "mtg_meetings"("company_id", "status");

-- CreateIndex
CREATE INDEX "mtg_meetings_organizer_id_idx" ON "mtg_meetings"("organizer_id");

-- CreateIndex
CREATE INDEX "mtg_participants_meeting_id_idx" ON "mtg_participants"("meeting_id");

-- CreateIndex
CREATE INDEX "mtg_participants_user_id_idx" ON "mtg_participants"("user_id");

-- CreateIndex
CREATE INDEX "mtg_agenda_items_meeting_id_idx" ON "mtg_agenda_items"("meeting_id");

-- CreateIndex
CREATE INDEX "mtg_minutes_meeting_id_idx" ON "mtg_minutes"("meeting_id");

-- CreateIndex
CREATE INDEX "mtg_action_items_meeting_id_idx" ON "mtg_action_items"("meeting_id");

-- CreateIndex
CREATE INDEX "mtg_action_items_assignee_id_idx" ON "mtg_action_items"("assignee_id");

-- CreateIndex
CREATE INDEX "mtg_action_items_status_idx" ON "mtg_action_items"("status");

-- CreateIndex
CREATE INDEX "mtg_attachments_meeting_id_idx" ON "mtg_attachments"("meeting_id");

-- CreateIndex
CREATE INDEX "mtg_activities_meeting_id_created_at_idx" ON "mtg_activities"("meeting_id", "created_at");

-- CreateIndex
CREATE INDEX "ntc_notices_company_id_idx" ON "ntc_notices"("company_id");

-- CreateIndex
CREATE INDEX "ntc_notices_company_id_status_idx" ON "ntc_notices"("company_id", "status");

-- CreateIndex
CREATE INDEX "ntc_notices_company_id_publish_at_idx" ON "ntc_notices"("company_id", "publish_at");

-- CreateIndex
CREATE INDEX "ntc_notices_created_by_idx" ON "ntc_notices"("created_by");

-- CreateIndex
CREATE INDEX "ntc_categories_company_id_idx" ON "ntc_categories"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ntc_categories_company_id_slug_key" ON "ntc_categories"("company_id", "slug");

-- CreateIndex
CREATE INDEX "ntc_audiences_notice_id_idx" ON "ntc_audiences"("notice_id");

-- CreateIndex
CREATE INDEX "ntc_audiences_audience_type_audience_id_idx" ON "ntc_audiences"("audience_type", "audience_id");

-- CreateIndex
CREATE INDEX "ntc_read_receipts_user_id_idx" ON "ntc_read_receipts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ntc_read_receipts_notice_id_user_id_key" ON "ntc_read_receipts"("notice_id", "user_id");

-- CreateIndex
CREATE INDEX "ntc_comments_notice_id_idx" ON "ntc_comments"("notice_id");

-- CreateIndex
CREATE INDEX "ntc_comments_user_id_idx" ON "ntc_comments"("user_id");

-- CreateIndex
CREATE INDEX "ntc_attachments_notice_id_idx" ON "ntc_attachments"("notice_id");

-- CreateIndex
CREATE UNIQUE INDEX "ntc_settings_company_id_key" ON "ntc_settings"("company_id");

-- CreateIndex
CREATE INDEX "appt_types_company_id_idx" ON "appt_types"("company_id");

-- CreateIndex
CREATE INDEX "appt_types_company_id_is_active_idx" ON "appt_types"("company_id", "is_active");

-- CreateIndex
CREATE INDEX "appt_services_company_id_idx" ON "appt_services"("company_id");

-- CreateIndex
CREATE INDEX "appt_services_company_id_is_active_idx" ON "appt_services"("company_id", "is_active");

-- CreateIndex
CREATE INDEX "appt_services_type_id_idx" ON "appt_services"("type_id");

-- CreateIndex
CREATE INDEX "appt_service_assignees_user_id_idx" ON "appt_service_assignees"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "appt_service_assignees_service_id_user_id_key" ON "appt_service_assignees"("service_id", "user_id");

-- CreateIndex
CREATE INDEX "appt_availability_company_id_idx" ON "appt_availability"("company_id");

-- CreateIndex
CREATE INDEX "appt_availability_company_id_user_id_day_of_week_idx" ON "appt_availability"("company_id", "user_id", "day_of_week");

-- CreateIndex
CREATE INDEX "appt_holidays_company_id_idx" ON "appt_holidays"("company_id");

-- CreateIndex
CREATE INDEX "appt_holidays_company_id_date_idx" ON "appt_holidays"("company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "appt_bookings_public_token_key" ON "appt_bookings"("public_token");

-- CreateIndex
CREATE INDEX "appt_bookings_company_id_idx" ON "appt_bookings"("company_id");

-- CreateIndex
CREATE INDEX "appt_bookings_company_id_starts_at_idx" ON "appt_bookings"("company_id", "starts_at");

-- CreateIndex
CREATE INDEX "appt_bookings_company_id_status_idx" ON "appt_bookings"("company_id", "status");

-- CreateIndex
CREATE INDEX "appt_bookings_user_id_starts_at_idx" ON "appt_bookings"("user_id", "starts_at");

-- CreateIndex
CREATE INDEX "appt_bookings_customer_id_idx" ON "appt_bookings"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "appt_booking_settings_company_id_key" ON "appt_booking_settings"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "appt_booking_settings_public_slug_key" ON "appt_booking_settings"("public_slug");

-- CreateIndex
CREATE INDEX "appt_activities_booking_id_created_at_idx" ON "appt_activities"("booking_id", "created_at");

-- AddForeignKey
ALTER TABLE "pm_projects" ADD CONSTRAINT "pm_projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_projects" ADD CONSTRAINT "pm_projects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_projects" ADD CONSTRAINT "pm_projects_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_projects" ADD CONSTRAINT "pm_projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_projects" ADD CONSTRAINT "pm_projects_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_project_members" ADD CONSTRAINT "pm_project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_project_members" ADD CONSTRAINT "pm_project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "pm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_dependencies" ADD CONSTRAINT "pm_task_dependencies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "pm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_dependencies" ADD CONSTRAINT "pm_task_dependencies_depends_on_task_id_fkey" FOREIGN KEY ("depends_on_task_id") REFERENCES "pm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_checklist_items" ADD CONSTRAINT "pm_task_checklist_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "pm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_comments" ADD CONSTRAINT "pm_task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "pm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_comments" ADD CONSTRAINT "pm_task_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_milestones" ADD CONSTRAINT "pm_milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_time_entries" ADD CONSTRAINT "pm_time_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_time_entries" ADD CONSTRAINT "pm_time_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "pm_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_time_entries" ADD CONSTRAINT "pm_time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_project_attachments" ADD CONSTRAINT "pm_project_attachments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_project_attachments" ADD CONSTRAINT "pm_project_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "pm_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_project_attachments" ADD CONSTRAINT "pm_project_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_project_activities" ADD CONSTRAINT "pm_project_activities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_project_activities" ADD CONSTRAINT "pm_project_activities_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "pm_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_project_activities" ADD CONSTRAINT "pm_project_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_project_settings" ADD CONSTRAINT "pm_project_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_meetings" ADD CONSTRAINT "mtg_meetings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_meetings" ADD CONSTRAINT "mtg_meetings_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_meetings" ADD CONSTRAINT "mtg_meetings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_participants" ADD CONSTRAINT "mtg_participants_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "mtg_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_participants" ADD CONSTRAINT "mtg_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_agenda_items" ADD CONSTRAINT "mtg_agenda_items_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "mtg_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_agenda_items" ADD CONSTRAINT "mtg_agenda_items_presenter_id_fkey" FOREIGN KEY ("presenter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_minutes" ADD CONSTRAINT "mtg_minutes_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "mtg_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_minutes" ADD CONSTRAINT "mtg_minutes_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_action_items" ADD CONSTRAINT "mtg_action_items_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "mtg_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_action_items" ADD CONSTRAINT "mtg_action_items_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_action_items" ADD CONSTRAINT "mtg_action_items_linked_task_id_fkey" FOREIGN KEY ("linked_task_id") REFERENCES "pm_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_attachments" ADD CONSTRAINT "mtg_attachments_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "mtg_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_attachments" ADD CONSTRAINT "mtg_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_activities" ADD CONSTRAINT "mtg_activities_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "mtg_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtg_activities" ADD CONSTRAINT "mtg_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ntc_notices" ADD CONSTRAINT "ntc_notices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ntc_notices" ADD CONSTRAINT "ntc_notices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ntc_notices" ADD CONSTRAINT "ntc_notices_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ntc_categories" ADD CONSTRAINT "ntc_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ntc_audiences" ADD CONSTRAINT "ntc_audiences_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "ntc_notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ntc_read_receipts" ADD CONSTRAINT "ntc_read_receipts_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "ntc_notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ntc_read_receipts" ADD CONSTRAINT "ntc_read_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ntc_comments" ADD CONSTRAINT "ntc_comments_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "ntc_notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ntc_comments" ADD CONSTRAINT "ntc_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ntc_attachments" ADD CONSTRAINT "ntc_attachments_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "ntc_notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ntc_attachments" ADD CONSTRAINT "ntc_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ntc_settings" ADD CONSTRAINT "ntc_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_types" ADD CONSTRAINT "appt_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_services" ADD CONSTRAINT "appt_services_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_services" ADD CONSTRAINT "appt_services_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "appt_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_service_assignees" ADD CONSTRAINT "appt_service_assignees_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "appt_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_service_assignees" ADD CONSTRAINT "appt_service_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_availability" ADD CONSTRAINT "appt_availability_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_availability" ADD CONSTRAINT "appt_availability_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_holidays" ADD CONSTRAINT "appt_holidays_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_holidays" ADD CONSTRAINT "appt_holidays_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_bookings" ADD CONSTRAINT "appt_bookings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_bookings" ADD CONSTRAINT "appt_bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "appt_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_bookings" ADD CONSTRAINT "appt_bookings_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "appt_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_bookings" ADD CONSTRAINT "appt_bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_bookings" ADD CONSTRAINT "appt_bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_bookings" ADD CONSTRAINT "appt_bookings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_booking_settings" ADD CONSTRAINT "appt_booking_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_activities" ADD CONSTRAINT "appt_activities_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "appt_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appt_activities" ADD CONSTRAINT "appt_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

