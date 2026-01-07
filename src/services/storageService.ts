import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

export const uploadToSupabase = async (
  file: Express.Multer.File,
  path: string,
) => {
  const { data, error } = await supabase.storage
    .from(env.SUPABASE_BUCKET_NAME)
    .upload(path, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from(env.SUPABASE_BUCKET_NAME)
    .getPublicUrl(data.path);

  return publicUrlData.publicUrl;
};
