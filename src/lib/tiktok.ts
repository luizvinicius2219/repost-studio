export type TikTokTokenResponse = {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
};

export type TikTokCreatorInfo = {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

export type TikTokPublishStatus = {
  status: "PROCESSING_UPLOAD" | "PROCESSING_DOWNLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED" | string;
  fail_reason?: string;
  publicaly_available_post_id?: Array<string | number>;
  uploaded_bytes?: number;
  downloaded_bytes?: number;
};

function config() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!clientKey || !clientSecret || !redirectUri) throw new Error("TikTok server configuration is incomplete.");
  return { clientKey, clientSecret, redirectUri };
}

async function parseResponse(res: Response) {
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const text = String(body.error_description ?? body.message ?? body.error ?? `TikTok HTTP ${res.status}`);
    throw new Error(text);
  }
  return body;
}

export function buildTikTokAuthorizationUrl(state: string) {
  const { clientKey, redirectUri } = config();
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("scope", "video.publish");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(params: URLSearchParams): Promise<TikTokTokenResponse> {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: params,
  });
  return await parseResponse(res) as unknown as TikTokTokenResponse;
}

export async function exchangeAuthorizationCode(code: string): Promise<TikTokTokenResponse> {
  const { clientKey, clientSecret, redirectUri } = config();
  return tokenRequest(new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  }));
}

export async function refreshTikTokToken(refreshToken: string): Promise<TikTokTokenResponse> {
  const { clientKey, clientSecret } = config();
  return tokenRequest(new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }));
}

export async function revokeTikTokToken(accessToken: string) {
  const { clientKey, clientSecret } = config();
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, token: accessToken }),
  });
  if (!res.ok) await parseResponse(res);
}

async function tiktokJson<T>(url: string, accessToken: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  const parsed = await parseResponse(res);
  const error = parsed.error as Record<string, unknown> | undefined;
  if (error && String(error.code ?? "ok") !== "ok") throw new Error(String(error.message ?? error.code));
  return parsed.data as T;
}

export async function queryCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
  return tiktokJson<TikTokCreatorInfo>(
    "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
    accessToken,
    {},
  );
}

export async function initializeDirectPostFromUrl(accessToken: string, input: {
  videoUrl: string;
  title: string;
  privacyLevel: string;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
  isAigc: boolean;
}) {
  return tiktokJson<{ publish_id: string }>(
    "https://open.tiktokapis.com/v2/post/publish/video/init/",
    accessToken,
    {
      post_info: {
        title: input.title,
        privacy_level: input.privacyLevel,
        disable_comment: !input.allowComment,
        disable_duet: !input.allowDuet,
        disable_stitch: !input.allowStitch,
        brand_content_toggle: input.brandContentToggle,
        brand_organic_toggle: input.brandOrganicToggle,
        is_aigc: input.isAigc,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: input.videoUrl,
      },
    },
  );
}

export async function fetchPublishStatus(accessToken: string, publishId: string): Promise<TikTokPublishStatus> {
  return tiktokJson<TikTokPublishStatus>(
    "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
    accessToken,
    { publish_id: publishId },
  );
}
