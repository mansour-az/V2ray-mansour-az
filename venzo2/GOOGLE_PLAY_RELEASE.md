# Venzo VPN — Google Play release checklist

## Build

- Package: `com.venzo.vpn`
- App bundle: `Venzo-VPN-2.3.0.aab`
- Distribution define: `LXBOX_DISTRIBUTION=play`
- Target API: inherited from Flutter 3.41.6 (API 36)
- Play App Signing: enable on first upload and preserve the existing upload key
- External checkout: hidden in the Play distribution

## Required Play Console declarations

1. Declare VPN as the app's core functionality in the VpnService form.
2. State that traffic is encrypted from the device to the selected VPN endpoint.
3. Provide a public privacy-policy URL based on `docs/PRIVACY_POLICY.md`.
4. Complete Data safety using the actual production API behavior.
5. Declare installed-app visibility, location/Wi-Fi access, camera access and
   foreground-service use exactly as implemented.
6. Upload a public or reviewer-accessible video, no longer than 90 seconds,
   showing app launch, VPN consent, connection and disconnection.
7. Complete App access, Ads, Content rating and Target audience forms.

## First rollout

1. Create the app as a free app in Play Console.
2. Upload the AAB to Internal testing first.
3. Resolve all pre-launch report and policy warnings.
4. Move to Closed testing. New personal developer accounts may be required to
   keep at least 12 opted-in testers for 14 continuous days before production.
5. Request production access, then submit the production release only after a
   final manual review.

## Commerce phase

The Play build must not open Venzo's external checkout for a digital VPN
subscription. Implement Google Play Billing products in Play Console, verify
purchase tokens server-side, acknowledge purchases, and provision PasarGuard
only after verification. The GitHub APK can keep the independent checkout.
