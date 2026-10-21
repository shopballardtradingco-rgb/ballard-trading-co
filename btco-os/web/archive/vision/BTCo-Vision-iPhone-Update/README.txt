BTCo Vision — iPhone Camera Update

Open BTCo Vision.xcodeproj in Xcode, select your signing team and your iPhone, then build and run. Allow Camera and Local Network access. Launch the existing Mac server with node server.js from ~/Desktop/btco-vision-server. The saved server address remains http://192.168.4.50:3000 in HandsFreeScanner.swift and ContentView.swift; change both if your Mac address changes.

This package reconstructs the app from the saved October 2 project and the latest saved October 3 scanner/app revisions. It starts directly in the automatic iPhone scanner. Front/back auto capture, flip detection, manual capture, sound, inventory checks and PSA lookup remain. The original manual ContentView and its shared response models remain available in source. The backend requires no glasses cleanup and is unchanged.

Meta SDK dependencies, registration/callback handling, glasses screens/feed, Bluetooth permissions, accessory protocols and background accessory modes have been removed. This package contains no saved signing credentials or Xcode user state. Restore your existing app icon assets if desired; the saved project archive did not contain them.

For an existing checkout, replace MyApp.swift, HandsFreeScanner.swift, the root BTCo-Vision-Info.plist and BTCo Vision.xcodeproj with these files, keeping your existing ContentView.swift and Assets.xcassets. Keep exactly one MyApp and one HandsFreeScanner source file in the target; remove any separate glasses-only source files you added locally.

Validation: property-list parse, project reference consistency and source checks completed. This environment cannot run Xcode or verify an iPhone build/camera session. On your phone, check front/back capture, Scan Next, Stop/Start, background/foreground, and a complete identification with the Mac server running.
