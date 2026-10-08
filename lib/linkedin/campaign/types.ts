// Row and config shapes shared by the campaign runner modules.

export interface ScheduleConfig {
  active_hours_start: number;
  active_hours_end: number;
  timezone: string;
  working_days: string;
}

export interface AccountLimits extends ScheduleConfig {
  daily_connection_limit: number;
  daily_message_limit: number;
  daily_inmail_limit: number;
  daily_visit_limit: number;
}

export interface EmailAccountLimits extends ScheduleConfig {
  daily_email_limit: number;
  ramp_up_enabled: number | null;
  ramp_start_date: string | null;
}

export interface WorkflowStep {
  id: string;
  step_order: number;
  track: "linkedin" | "email";
  step_type: "visit" | "connect" | "message" | "sales_inmail" | "delay" | "email";
  template_id: string | null;
  delay_seconds: number;
  connect_note: string | null;
  message_body: string | null;
  email_subject: string | null;
  email_body: string | null;
  ai_enabled: number | null;
  ai_model: string | null;
  ai_prompt: string | null;
  ai_max_words: number | null;
  ai_language: string | null;
  email_position: number | null;
  message_position: number | null;
  email_signature: string | null;
  email_delivery_mode: "plain" | "enhanced" | null;
  email_track_opens: number | null;
  email_track_clicks: number | null;
}

// A track-run row joined with its parent run_profile and run context
export interface TrackRun {
  // run_profile_tracks columns
  id: string;
  run_profile_id: string;
  track: "linkedin" | "email";
  state: string;
  current_step: number;
  next_step_at: string | null;
  error_message: string | null;
  last_email_subject: string | null;
  last_email_body: string | null;
  last_linkedin_message: string | null;
  pending_reply_context: string | null;
  // joined from run_profiles / runs
  run_id: string;
  target_id: string;
  email_account_id: string | null;
  account_id: string;
  workflow_id: string;
  // joined from targets — lets the daily-limit gate tell a NEW connect send apart
  // from a free acceptance recheck on an already-sent request
  connection_requested_at: string | null;
}

export interface Target {
  id: string;
  linkedin_url: string;
  sales_nav_url: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  degree: number | null;
  connection_requested_at: string | null;
  connected_at: string | null;
  email: string | null;
  email_status: string | null;
  /** When the address was last CHECKED — not a claim that it passed. Doubles as the
   *  re-check throttle for addresses whose verdict came back inconclusive. */
  email_verified_at: string | null;
  email_replied_at: string | null;
  company_id: string | null;
  workspace_id: string;
}

export interface Template { id: string; body: string; }
