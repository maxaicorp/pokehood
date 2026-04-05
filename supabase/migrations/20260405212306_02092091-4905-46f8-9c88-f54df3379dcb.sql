
-- Create the card-images storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('card-images', 'card-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access
CREATE POLICY "Public read card-images" ON storage.objects
  FOR SELECT USING (bucket_id = 'card-images');

-- Anon upload access (for the caching script)
CREATE POLICY "Anon upload card-images" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'card-images');
