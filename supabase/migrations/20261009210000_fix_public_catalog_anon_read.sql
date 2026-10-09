-- Split the public and staff content read paths. Anonymous visitors should
-- never evaluate admin_memberships checks (and should not have SELECT on it).
-- This fixes 42501 permission denied when the public catalog loads.
ALTER POLICY cinaro_content_read ON public.content TO authenticated;

DROP POLICY IF EXISTS cinaro_content_public_read ON public.content;
CREATE POLICY cinaro_content_public_read
  ON public.content
  FOR SELECT
  TO anon
  USING (published = true);
