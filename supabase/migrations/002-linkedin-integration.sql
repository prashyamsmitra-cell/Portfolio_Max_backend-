-- Migration: Add LinkedIn Integration Fields to Posts Table
-- Run this SQL in Supabase SQL Editor after schema.sql updates

-- Add LinkedIn-related columns to posts table
ALTER TABLE public.posts
ADD COLUMN IF NOT EXISTS linkedin_post_id TEXT CHECK (char_length(linkedin_post_id) <= 255),
ADD COLUMN IF NOT EXISTS linkedin_post_url TEXT CHECK (char_length(linkedin_post_url) <= 500),
ADD COLUMN IF NOT EXISTS linkedin_comments_url TEXT CHECK (char_length(linkedin_comments_url) <= 500),
ADD COLUMN IF NOT EXISTS linkedin_shares_url TEXT CHECK (char_length(linkedin_shares_url) <= 500),
ADD COLUMN IF NOT EXISTS linkedin_likes_url TEXT CHECK (char_length(linkedin_likes_url) <= 500);

-- Create index for LinkedIn fields
CREATE INDEX IF NOT EXISTS posts_linkedin_idx ON public.posts (linkedin_post_id);

-- Update example posts with LinkedIn integration
-- Uncomment and fill with actual data as needed
/*
UPDATE public.posts SET
  linkedin_post_id = 'urn:li:activity:123456789',
  linkedin_post_url = 'https://linkedin.com/posts/example-123456'
WHERE slug = 'your-post-slug';
*/