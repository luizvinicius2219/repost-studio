-- Repost Studio V0.8 - Buffer. Executar no Supabase SQL Editor apos V0.7.
-- Preserva todos os agendamentos, contas e videos existentes.
ALTER TABLE public.publishing_accounts ADD COLUMN IF NOT EXISTS buffer_channel_id text;
ALTER TABLE public.publishing_accounts ADD COLUMN IF NOT EXISTS buffer_organization_id text;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS buffer_post_id text;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS buffer_status text;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS buffer_last_checked_at timestamptz;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS buffer_dispatch_state text NOT NULL DEFAULT 'not_sent';
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_buffer_post_id ON public.posts(buffer_post_id) WHERE buffer_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_buffer_pending ON public.posts(status,buffer_dispatch_state) WHERE buffer_post_id IS NOT NULL;
