export type SourceProfile = {
  id: string;
  username: string;
  profile_url: string;
  channel_id: string | null;
  is_active: boolean;
  sync_status: "idle" | "pending" | "running" | "waiting_user" | "completed" | "partial" | "failed";
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PublishingAccountRow = {
  id: string;
  username: string;
  label: string | null;
  is_active: boolean;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type ScheduleSlotRow = {
  id: string;
  account_id: string;
  weekday: number;
  time_local: string;
  is_active: boolean;
  created_at: string;
};

export type OnlineVideo = {
  id: string;
  source_profile_id: string | null;
  tiktok_video_id: string;
  title: string | null;
  source_url: string;
  thumbnail_url: string | null;
  storage_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  status: "discovered" | "downloading" | "downloaded" | "uploading" | "uploaded" | "failed";
  error_message: string | null;
  metadata: Record<string, unknown>;
  discovered_at: string;
  uploaded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SyncJobRow = {
  id: string;
  source_profile_id: string;
  status: "pending" | "running" | "waiting_user" | "completed" | "partial" | "failed" | "cancelled";
  found_count: number;
  new_count: number;
  downloaded_count: number;
  uploaded_count: number;
  error_count: number;
  message: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type PostRow = {
  id: string;
  account_id: string;
  video_id: string;
  scheduled_at: string;
  status: "draft" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";
  error_message: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StudioSnapshot = {
  profiles: SourceProfile[];
  accounts: PublishingAccountRow[];
  slots: ScheduleSlotRow[];
  videos: OnlineVideo[];
  jobs: SyncJobRow[];
  posts: PostRow[];
  serverTime: string;
};
