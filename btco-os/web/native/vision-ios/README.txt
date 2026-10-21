BTCo Vision — maintained iPhone source in BTCo OS 0.5.0

Open BTCo Vision.xcodeproj in Xcode on the Mac. Select the intended team and supported iPhone target, then build and run. Allow Camera and Local Network access. Refer to ../../docs/VISION.md and ../../services/vision-node/README.md for service startup and connection settings.

The active source uses the cleaned iPhone-only project and latest recovered scanner and acquisition controls. The service URL is configurable under Buying Controls → Vision connection; its token is stored in Keychain. The historical LAN address is the default. Network access to the maintained Node service requires a bearer token. Native inventory lookup still uses its configured historical CSV; browser Vision uses the shared Vault.

Glasses SDK dependencies and Xcode user state remain excluded. Original source snapshots and older instructions are preserved in ../../archive/vision/. The recovered project has no full app icon set; restore the intended assets on the Mac if needed.

Xcode compilation, signing and physical camera/provider tests cannot run in the Linux development environment. Check front/back capture, Scan Next, Stop/Start, foreground/background recovery, service authorization, and the buying worksheet on the intended iPhone before relying on the native build.
