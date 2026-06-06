# Capacitor (Android) — workflow

The web app is wrapped with Capacitor so it can ship to the Play Store. The
website (Lovable) is unaffected — Capacitor only adds `capacitor.config.ts` +
the `android/` native project.

- **appId:** `app.collectiblez`  **appName:** `Collectiblez`
- **webDir:** `dist` (the app bundles the built SPA; it calls the live Supabase
  backend over the network, same as the website)
- The bundled web assets (`android/app/src/main/assets/public`) and all Gradle
  build artifacts are **gitignored** — only native source is committed.

## One-time setup (your machine)
1. Install **Android Studio** (bundles a JDK + the Android SDK).
2. Open the project: from the repo run `npx cap open android` (or open the
   `android/` folder in Android Studio). First open auto-creates
   `android/local.properties` with your SDK path (gitignored).
3. Let **Gradle sync** finish (downloads dependencies — needs internet).

## Run it
- In Android Studio, pick an emulator or a connected device and hit **Run ▶**.
- The app loads the bundled SPA.

## Dev loop (after any web code change)
```bash
npm run build:app      # lean SPA build (NO 20k prerender files — important)
npx cap sync android   # copy dist -> android + update plugins
# then re-Run in Android Studio
```
⚠️ Use `build:app`, NOT `npm run build` — the latter's `postbuild` prerenders
~20k SEO HTML pages that must never be bundled into the app.

## Still TODO before store submission
- **App icon / splash** — replace the default Capacitor launcher icons
  (`android/app/src/main/res/mipmap-*`); easiest via `@capacitor/assets`.
- **Signing** — generate a release keystore + configure signing in Android Studio
  (your Google Play account).
- **OAuth redirects** — if Google/social sign-in is used, add the app's custom
  scheme/deep link to the Supabase auth redirect allow-list. Email/password works
  as-is.
- **Push notifications** (optional) — add `@capacitor/push-notifications` if you
  want them (also strengthens App Store review vs a "pure web wrapper").
- **iOS** — needs a Mac + Xcode: `npm i @capacitor/ios && npx cap add ios`.

## Live-reload while developing (optional)
Point the app at your dev server instead of the bundled build by temporarily
adding to `capacitor.config.ts`:
```ts
server: { url: 'http://<your-LAN-ip>:8080', cleartext: true }
```
Remove it before building the production app.
