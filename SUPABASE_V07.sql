-- =========================================================
-- REPOST STUDIO V0.7
-- TikTok OAuth + publicador online + limpeza de Storage
-- Execute uma vez no SQL Editor do Supabase.
-- =========================================================

create table if not exists public.tiktok_connections (
    account_id uuid primary key
        references public.publishing_accounts(id)
        on delete cascade,

    open_id text not null unique,
    creator_username text,
    creator_nickname text,
    avatar_url text,
    scope text not null,

    -- Tokens ficam criptografados pela aplicacao antes de chegar ao banco.
    access_token_enc text not null,
    refresh_token_enc text not null,
    access_expires_at timestamptz not null,
    refresh_expires_at timestamptz not null,

    connected_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.tiktok_connections enable row level security;

-- Metadados exigidos para a revisao e publicacao no TikTok.
alter table public.posts add column if not exists title text;
alter table public.posts add column if not exists privacy_level text;
alter table public.posts add column if not exists allow_comment boolean not null default false;
alter table public.posts add column if not exists allow_duet boolean not null default false;
alter table public.posts add column if not exists allow_stitch boolean not null default false;
alter table public.posts add column if not exists brand_content_toggle boolean not null default false;
alter table public.posts add column if not exists brand_organic_toggle boolean not null default false;
alter table public.posts add column if not exists is_aigc boolean not null default false;
alter table public.posts add column if not exists rights_confirmed boolean not null default false;
alter table public.posts add column if not exists approved_at timestamptz;
alter table public.posts add column if not exists tiktok_publish_id text;
alter table public.posts add column if not exists tiktok_post_id text;
alter table public.posts add column if not exists publish_started_at timestamptz;
alter table public.posts add column if not exists last_status_check_at timestamptz;
alter table public.posts add column if not exists attempt_count integer not null default 0;

-- Arquivo pode ser apagado do bucket depois que nao houver mais usos pendentes.
alter table public.videos add column if not exists storage_deleted_at timestamptz;

-- V0.6 nao possuia o estado "published" no video.
alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos
    add constraint videos_status_check
    check (
        status in (
            'discovered',
            'downloading',
            'downloaded',
            'uploading',
            'uploaded',
            'failed',
            'published'
        )
    );

-- Privacidade salva somente depois da escolha manual na tela de revisao.
alter table public.posts drop constraint if exists posts_privacy_level_check;
alter table public.posts
    add constraint posts_privacy_level_check
    check (
        privacy_level is null
        or privacy_level in (
            'PUBLIC_TO_EVERYONE',
            'MUTUAL_FOLLOW_FRIENDS',
            'FOLLOWER_OF_CREATOR',
            'SELF_ONLY'
        )
    );

create index if not exists idx_posts_due
    on public.posts(status, scheduled_at);

create index if not exists idx_posts_publish_id
    on public.posts(tiktok_publish_id);

create index if not exists idx_tiktok_connections_open_id
    on public.tiktok_connections(open_id);

-- Itens que ja existiam na V0.6 continuam agendados, mas precisam ser
-- revisados/autorizados manualmente antes do publicador automatico usa-los.
update public.posts
set
    approved_at = null,
    rights_confirmed = false,
    updated_at = now()
where status = 'scheduled';
