
CREATE POLICY "Anon update card-images" ON storage.objects
  FOR UPDATE USING (bucket_id = 'card-images') WITH CHECK (bucket_id = 'card-images');
