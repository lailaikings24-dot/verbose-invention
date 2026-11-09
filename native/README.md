# Native Android & iOS builds

The web app in `../src` is the whole product. These two files are the piece the
browser cannot provide: a Bluetooth stack.

| Platform | Browser (PWA) | This native shell |
| --- | --- | --- |
| Android | BLE only (Web Bluetooth, Chrome/Edge) | BLE **and** Bluetooth Classic (SPP) |
| iOS | nothing — Safari has no Bluetooth API | BLE (CoreBluetooth) |
| Desktop | BLE only | not applicable |

Wi-Fi (ELM327 WiFi / OBDLink WiFi) works everywhere through the WebSocket
transport, no native build required.

## What is here

```
native/
├── android/VehicleLinkPlugin.kt     Capacitor plugin — BLE + Classic SPP
├── ios/VehicleLinkPlugin.swift      Capacitor plugin — BLE (CoreBluetooth)
├── AndroidManifest.additions.xml    permissions to merge
├── Info.plist.additions.xml         usage strings to merge
└── README.md
```

The JavaScript side already exists and needs no changes:

- `src/lib/native/bridge.ts` — typed, dependency-free client for the plugin
- `src/lib/native/transport.ts` — `Transport` implementation used by the OBD service
- `src/pages/Connect.tsx` — scan list, shown automatically when the plugin is present

The bridge is discovered at runtime via `window.Capacitor.Plugins.VehicleLink`,
so the web build stays a plain web build and has no Capacitor dependency.

## Create the projects

```bash
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/android @capacitor/ios
npx cap add android
npx cap add ios          # macOS only
```

`capacitor.config.json` already points at `dist`, so build the web app first:

```bash
npm run build 
npx cap sync
```

## Android

1. Copy `android/VehicleLinkPlugin.kt` to
   `android/app/src/main/java/com/torquemedic/app/VehicleLinkPlugin.kt`
   (create the directory; keep the `package` line matching).
2. Register it in `MainActivity.kt`:

   ```kotlin
   package com.torquemedic.app

   import android.os.Bundle
   import com.getcapacitor.BridgeActivity

   class MainActivity : BridgeActivity() {
       override fun onCreate(savedInstanceState: Bundle?) {
           registerPlugin(VehicleLinkPlugin::class.java)
           super.onCreate(savedInstanceState)
       }
   }
   ```

3. Merge `AndroidManifest.additions.xml` into
   `android/app/src/main/AndroidManifest.xml`.
4. Run it, or build a signed APK/AAB for Play:

   ```bash
   npx cap run android          # device or emulator
   cd android && ./gradlew assembleRelease
   ```

`minSdkVersion` 23 is enough (Capacitor's default). No background Bluetooth
service is used, so no foreground-service permission is needed.

## iOS

1. Copy `ios/VehicleLinkPlugin.swift` to `ios/App/App/VehicleLinkPlugin.swift`.
2. Open `ios/App/App.xcworkspace` in Xcode and add the file to the **App** target.
   Xcode 15's file-system groups pick it up automatically.
3. Merge `Info.plist.additions.xml` into `ios/App/App/Info.plist`.
4. Set a development team under *Signing & Capabilities* (Bluetooth needs no
   special capability, just the usage strings).
5. Run on a physical iPhone — the simulator has no Bluetooth radio.

```bash
npx cap run ios 
```

Bluetooth Classic / SPP dongles cannot be supported on iOS: Apple requires MFi
certification for those. BLE adapters and Wi-Fi adapters both work.

## How the plugin behaves

Both implementations expose the same five methods and two events:

| Method | Purpose |
| --- | --- |
| `available()` | radio present / powered / permission granted, with a human reason |
| `scan({ timeoutMs })` | nearby adapters: `{ id, name, rssi, link: 'ble' \| 'classic' }` |
| `connect({ id, link })` | opens GATT (or RFCOMM on Android) and resolves `{ name, profile }` |
| `write({ data })` | sends ELM327 text, chunked to 20 bytes for BLE serial bridges |
| `disconnect()` | closes the link |

Events: `data` → `{ data }` (adapter output) and `linkLost` → `{ reason }`.
The transport reconnects nothing on its own — a dropped link surfaces in the UI
so the user is not shown stale sensor values.

## Verification status

These native files have **not been compiled**: this workspace has no Android SDK
or Xcode. The TypeScript side they talk to is typechecked and unit-exercised
through the simulator, but building and running the two native projects — and
pairing a real dongle on a real phone — has to happen in Android Studio and
Xcode.
