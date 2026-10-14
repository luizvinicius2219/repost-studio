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
  status: "discovered" | "downloading" | "downloaded" | "uploading" | "uploaded" | "failed" | "published";
  error_message: string | null;
  metadata: Record<string, unknown>;
  discovered_at: string;
  uploaded_at: string | null;
  storage_deleted_at: string | null;
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
  title: string | null;
  privacy_level: string | null;
  allow_comment: boolean;
  allow_duet: boolean;
  allow_stitch: boolean;
  brand_content_toggle: boolean;
  brand_organic_toggle: boolean;
  is_aigc: boolean;
  rights_confirmed: boolean;
  approved_at: string | null;
  tiktok_publish_id: string | null;
  tiktok_post_id: string | null;
  publish_started_at: string | null;
  last_status_check_at: string | null;
  attempt_count: number;
};

export type TikTokConnectionSummary = {
  account_id: string;
  open_id: string;
  creator_username: string | null;
  creator_nickname: string | null;
  avatar_url: string | null;
  scope: string;
  access_expires_at: string;
  connected_at: string;
  updated_at: string;
};

export type StudioSnapshot = {
  profiles: SourceProfile[];
  accounts: PublishingAccountRow[];
  slots: ScheduleSlotRow[];
  videos: OnlineVideo[];
  jobs: SyncJobRow[];
  posts: PostRow[];
  tiktokConnections: TikTokConnectionSummary[];
  storageBytes: number;
  storageLimitBytes: number;
  publisherConfigured: boolean;
  tiktokAudited: boolean;
  serverTime: string;
};
