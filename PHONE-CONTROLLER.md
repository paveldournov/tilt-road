# iPhone tilt controller — local only

## Start both servers

1. Run `npm run dev` and keep the desktop game open at **http://localhost:3000**.
2. In another terminal, run **`npm run phone:server`**. It prints your computer's LAN setup and HTTPS controller URLs. Leave it running.
3. On the game, click **Connect iPhone** to show the two-digit code and certificate fingerprint.
4. On iPhone Safari, on the same network, open the printed **HTTP setup URL**. It provides the certificate profile and instructions. After installation and explicit trust, open the **HTTPS controller URL**.
5. Enter the code, Connect, Enable motion → Allow. Hold the phone still in portrait with the screen tilted up at a comfortable angle, then Calibrate neutral → Start / Resume.

Tip the phone's top away from you to accelerate, toward you to brake. Lower the left/right edge to steer. The **Steering** and **Acceleration / braking** sliders independently adjust response from **0.5× to 4×**; move right for more sensitivity. Both default to **2×** the original response: full input at 13.5° from neutral instead of 25°. The 2° neutral dead zone remains unchanged. Labels preview while dragging; release to apply. Changes pause the game but preserve calibration—tap Start / Resume to continue. Preferences are saved locally on the phone when browser storage is available; Reset both to 2× restores defaults.

Calibrate neutral instantly captures the latest phone position as zero; there is no averaging, hold-still delay, or server acknowledgement. Pitch and roll percentages update locally as the phone moves, including while the game is paused. Screen rotation, hiding/locking Safari, missing samples and disconnects still pause the game. Brief interruptions keep the zero position; after reconnecting, tap Calibrate again. The phone has Pause and Restart buttons too. Keep the computer's game visible.

## Why the certificate?

Motion access is restricted to secure contexts and permission must be requested from a user gesture. Ordinary `http://192.168.x.x` pages are not secure contexts. See the [W3C orientation specification](https://www.w3.org/TR/orientation-event/).

The local server creates a short-lived development CA and a TLS certificate valid for this computer's current LAN IPv4 addresses. It serves a profile containing **only the public CA certificate**. Nothing is installed or trusted on either device automatically. On iPhone:

- Settings → General → VPN & Device Management → RoadTilt Local Controller → Install.
- Settings → General → About → Certificate Trust Settings → enable full trust for RoadTilt Local Controller.

See [Apple's certificate trust instructions](https://support.apple.com/en-us/102390). Compare the fingerprint with the computer's pairing panel. Trust only your own machine's certificate. A trusted CA can issue certificates accepted by your phone: keep `.local/phone/ca-key.pem` private. Remove the profile after testing via VPN & Device Management → RoadTilt Local Controller → Remove Profile. It expires after 30 days.

Keys and generated certificates are kept in **`.local/phone/`**, excluded from Git and never served. OpenSSL is required; Git for Windows' `D:/git/usr/bin/openssl.exe` is detected here. Else install OpenSSL or set `ROADTILT_OPENSSL` to its executable. Changing LAN IPs regenerates the leaf certificate but reuses the CA, so you don't need to re-trust it. For an expired CA, remove the old iPhone profile, archive the local certificate directory, and restart to create a new one.

## Connection troubleshooting

- Both devices must share a LAN. An Ethernet computer and Wi-Fi iPhone are fine if the router bridges them. Guest isolation, cellular, VPN routing and enterprise network restrictions can prevent access.
- The game stays loopback-only. Only the dedicated controller server is LAN-facing, on TCP **8786** (setup and loopback game relay) and **8787** (HTTPS controller and secure phone relay).
- If Windows asks, allow Node.js for **Private networks only**. No firewall rules are automatically changed. Do not disable your firewall, open router ports, or expose the development relay publicly.
- In the desktop browser, allow local-network access if prompted. A stale game tab may need a reload to show Connect iPhone.
- The game URL must be `http://localhost:3000` or `http://127.0.0.1:3000`. The phone must use the printed LAN URL, not localhost. This local input mode is intentionally disabled on hosted sites.
- If Safari refuses HTTPS, verify both profile installation and the separate full-trust switch. Don't bypass TLS warnings. Check computer/phone clocks and the exact printed IP address.
- If multiple network adapters exist, start with `ROADTILT_LAN_IP` set to the desired assigned IPv4 address. Ports are 8786/8787 by default; the game receiver expects 8786.

## Protocol and safety

The desktop explicitly opens a room and receives a randomly selected two-digit pairing code (10–99), unique among open rooms. Short codes are convenient but easy to guess: use this only on a trusted private LAN, not a public or shared network. `/game` accepts only loopback connections from the local game's allowed origins. `/phone` accepts only HTTPS-origin WSS connections. The phone must pair before sending anything; one controller is allowed per room. Pairing attempts are rate limited. Payloads are limited to 1 KB, motion to 100 messages/second, samples must be finite and sequenced, and all axes are clamped to [-1,1]. Traffic remains on your LAN; no cloud service is used.

The phone samples device orientation and transmits approximately 30 times per second. Calibration averages stable samples, a 2-degree dead zone suppresses jitter, and the existing game input adapter smooths the tilt. Portrait beta/gamma are relative to the captured neutral. The phone stops after 200 ms without a fresh sensor event. The game receiver pauses after 500 ms without input; the relay also suspends after 600 ms. A fresh stream alone never resumes flight; Start/Resume is explicit. Local keyboard/touch still overrides incoming tilt. This is a game controller, not a safety-rated physical motion controller.

## Tests

`npm test` includes real loopback TLS/WebSocket pairing and streaming, unauthorized origins and plaintext phones, duplicate controllers, malformed/replayed samples, packet-loss pause, and calibration math. It generates a separate ignored test CA in `.local/phone-tests/` without trusting it in the OS. `npm run typecheck` and `npm run build` validate the game integration.

Actual iPhone permission prompts, certificate installation, tilt feel and connectivity through your router/firewall still require the physical phone. No certificate trust or firewall change is automated.
