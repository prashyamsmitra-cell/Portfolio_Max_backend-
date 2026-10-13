-- Run once in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 160),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  excerpt       text not null default '' check (char_length(excerpt) <= 400),
  content       text not null default '',                 -- Markdown
  cover_image   text,
  images        text[] not null default '{}',             -- photo slots (LinkedIn-style gallery); images[0] = cover
  tags          text[] not null default '{}',
  published     boolean not null default false,
  featured      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,
  -- LinkedIn integration fields
  linkedin_post_id text check (char_length(linkedin_post_id) <= 255),
  linkedin_post_url text check (char_length(linkedin_post_url) <= 500),
  linkedin_comments_url text check (char_length(linkedin_comments_url) <= 500),
  linkedin_shares_url text check (char_length(linkedin_shares_url) <= 500),
  linkedin_likes_url text check (char_length(linkedin_likes_url) <= 500)
);

create index if not exists posts_published_idx on public.posts (published, published_at desc);

-- Migration for databases created before photo slots existed (safe to re-run).
alter table public.posts add column if not exists images text[] not null default '{}';

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at before update on public.posts
  for each row execute function public.set_updated_at();

-- Row Level Security: drafts are private. The public (anon) role may only read published rows.
-- All writes go through /api/posts using the service-role key (which bypasses RLS) after an admin check.
alter table public.posts enable row level security;
drop policy if exists "public can read published posts" on public.posts;
create policy "public can read published posts" on public.posts
  for select to anon, authenticated using (published = true);

-- Public bucket for cover images (uploads happen server-side via /api/upload).
insert into storage.buckets (id, name, public) values ('post-covers', 'post-covers', true)
  on conflict (id) do nothing;

-- Migration to add LinkedIn fields for existing databases
alter table public.posts add column if not exists linkedin_post_id text check (char_length(linkedin_post_id) <= 255);
alter table public.posts add column if not exists linkedin_post_url text check (char_length(linkedin_post_url) <= 500);
alter table public.posts add column if not exists linkedin_comments_url text check (char_length(linkedin_comments_url) <= 500);
alter table public.posts add column if not exists linkedin_shares_url text check (char_length(linkedin_shares_url) <= 500);
alter table public.posts add column if not exists linkedin_likes_url text check (char_length(linkedin_likes_url) <= 500);

-- Create index for LinkedIn fields
create index if not exists posts_linkedin_idx on public.posts (linkedin_post_id);
