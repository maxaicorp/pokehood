# Collectiblez Video Studio V1

This is the first implementation plan for an internal marketing video studio. The goal is not to clone HeyGen. The goal is to make feature launches easy to market by recording the real Collectiblez UI and turning it into premium, reusable product videos.

## Product Goal

Build an admin-only Video Studio at `/admin/video-studio` where we can:

- Record the current browser tab or app window.
- Pick scripted demo presets for common product flows.
- Capture or define click-follow camera moments.
- Export short videos for X, TikTok, Instagram, YouTube Shorts, and launch pages.

## Smart Architecture

Use a hybrid system:

- **Manual recorder now:** Browser `getDisplayMedia` + `MediaRecorder` captures raw `.webm` clips.
- **Scripted demos next:** Playwright opens the app, runs a route/click/scroll script, and records the UI automatically.
- **Premium render pipeline after that:** Remotion takes the raw clip, camera path, captions, intro/outro, logo, and aspect ratio, then renders the final `.mp4`.

This keeps V1 simple while still aiming at the polished output we want.

## Premium Camera Movement

The platform you remembered sounds like a Screen Studio-style camera. That effect is possible.

Implementation model:

1. Record the screen normally.
2. Capture click positions and timestamps.
3. Convert those moments into camera keyframes:
   - `timeMs`
   - `xPct`
   - `yPct`
   - `zoom`
   - `easing`
   - `label`
4. Remotion renders the final video by smoothly scaling and translating the screen recording around those keyframes.

This is better than zooming the live browser during recording because we can edit the path after the recording.

## V1 Surface

Admin route:

- `/admin/video-studio`

Primary panels:

- **Record:** Start/stop tab capture, preview the `.webm`, download locally.
- **Demo presets:** Define the flows we want to automate later.
- **Camera path:** Click a preview frame to add focus points, tune zoom, and reorder/edit moments.
- **Export plan:** Choose output ratio and see what the Remotion render queue will own.

## Demo Presets

Starter presets:

- Gacha pack launch: `/gacha` -> choose premium pack -> wallet panel -> CTA.
- Market card search: `/` -> search -> card detail -> sentiment/vault CTA.
- Set page scroll: `/sets` -> set detail -> card grid -> market signal.

## Security and Limits

- Admin-only route.
- Browser permission prompt is required for manual capture.
- No silent screen recording.
- Raw recordings should be private by default once storage is added.
- Render jobs must validate admin auth server-side.
- Any public share link should use signed URLs or explicitly published assets.

## Backend Work Still Needed

- Add a `video_projects` table for project metadata.
- Add `video_recordings` or storage object metadata for raw clips.
- Add `video_render_jobs` for render queue state.
- Add a Supabase Edge Function or worker endpoint to create Playwright recordings.
- Add a render worker for Remotion output.
- Store final MP4s in Supabase Storage or an object store.

## V1 Acceptance

V1 is useful when:

- Admins can open `/admin/video-studio`.
- Admins can record a tab/window and download the raw `.webm`.
- Demo presets and camera keyframes are visible and editable locally.
- The route/nav are wired into the admin app.
- Typecheck and production build pass.
