import SwiftUI
import UIKit
import Combine
import MWDATCore
import MWDATCamera

@main
struct MyApp: App {
    private let setupError: String?

    init() {
        do {
            try Wearables.configure()
            setupError = nil
        } catch {
            setupError = error.localizedDescription
        }
    }

    var body: some Scene {
        WindowGroup {
            BTCoGlassesHome(setupError: setupError)
        }
    }
}

@MainActor
struct BTCoGlassesHome: View {
    let setupError: String?
    @StateObject private var glasses = BTCoGlassesCamera()
    @State private var showScanner = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    Image(systemName: "eyeglasses").font(.system(size: 44))
                    Text("BTCo Vision").font(.largeTitle.bold())
                    Text("Glasses Camera").font(.title3)
                    Text(glasses.status).multilineTextAlignment(.center)

                    if let image = glasses.frame {
                        Image(uiImage: image).resizable().scaledToFit()
                            .frame(maxHeight: 380)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                    }

                    if let setupError {
                        Text("Meta setup: \(setupError)").foregroundStyle(.red)
                    } else {
                        Text("Registration: \(glasses.registrationText) • Devices: \(glasses.deviceCount)")
                            .font(.caption).foregroundStyle(.secondary)

                        if !glasses.isRegistered {
                            Button("Connect Glasses") {
                                Task { await glasses.register() }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(glasses.isBusy)
                            Text("This opens Meta AI to authorize BTCo Vision. Enable Developer Mode in Meta AI for this development build.")
                                .font(.footnote).foregroundStyle(.secondary)
                        } else {
                            if !glasses.hasSession {
                                Button("Start Glasses Camera") {
                                    Task { await glasses.startCamera() }
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(glasses.isBusy)
                                Text("If needed, Meta AI will ask for camera access.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            } else {
                                Button("Stop Glasses Camera") { glasses.stopCamera() }
                                    .buttonStyle(.bordered)
                            }
                            Button("Scan Cards") { showScanner = true }
                                .buttonStyle(.borderedProminent)
                                .disabled(!glasses.isLive)
                        }
                    }

                    if glasses.isBusy { ProgressView() }
                    if !glasses.errorMessage.isEmpty {
                        Text(glasses.errorMessage).foregroundStyle(.red)
                            .font(.footnote).textSelection(.enabled)
                    }
                    Text("Wear the glasses with the arms open. First confirm this preview follows your glasses, then tap Scan Cards.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .padding()
                .frame(maxWidth: .infinity)
            }
        }
        .task { if setupError == nil { glasses.observe() } }
        .onOpenURL { url in
            guard setupError == nil else { return }
            Task { await glasses.handleCallback(url) }
        }
        .onChange(of: scenePhase) { _, phase in
            // Registration and permission redirects happen before a session exists.
            // End an active camera session when backgrounded, but keep those redirects alive.
            if phase == .background, glasses.hasSession {
                glasses.stopCamera()
                showScanner = false
            }
        }
        .fullScreenCover(isPresented: $showScanner) {
            HandsFreeScanner(glasses: glasses)
                .safeAreaInset(edge: .top) {
                    HStack {
                        Button("Back to Glasses") { showScanner = false }
                        Spacer()
                        Text(glasses.isLive ? "GLASSES LIVE" : "CAMERA PAUSED")
                            .font(.caption.bold())
                    }
                    .padding().foregroundStyle(.white).background(.black)
                }
        }
    }
}

/// Uses the public DAT 1.0.0 DeviceSession -> Camera -> Stream API.
@MainActor
final class BTCoGlassesCamera: ObservableObject {
    @Published private(set) var frame: UIImage?
    @Published private(set) var isLive = false
    @Published private(set) var isBusy = false
    @Published private(set) var hasSession = false
    @Published private(set) var isRegistered = false
    @Published private(set) var registrationText = "Not connected"
    @Published private(set) var deviceCount = 0
    @Published private(set) var status = "Connect BTCo Vision to your glasses."
    @Published private(set) var errorMessage = ""

    private var observed = false
    private var appTokens: [any AnyListenerToken] = []
    private var cameraTokens: [any AnyListenerToken] = []
    private var session: DeviceSession?
    private var selector: AutoDeviceSelector?
    private var camera: MWDATCamera.Camera?
    private var timeoutTask: Task<Void, Never>?
    private var generation = UUID()
    private var streamIsRunning = false

    func observe() {
        guard !observed else { return }
        observed = true
        let wearables = Wearables.shared
        updateRegistration(wearables.registrationState)
        deviceCount = wearables.devices.count
        appTokens.append(wearables.addRegistrationStateListener { [weak self] state in
            Task { @MainActor in self?.updateRegistration(state) }
        })
        appTokens.append(wearables.addDevicesListener { [weak self] devices in
            Task { @MainActor in self?.deviceCount = devices.count }
        })
    }

    private func updateRegistration(_ state: RegistrationState) {
        let wasRegistered = isRegistered
        isRegistered = state == .registered
        registrationText = state.description
        if isRegistered, !hasSession, !isBusy {
            status = "Connected to Meta AI. Start the glasses camera."
        }
        if wasRegistered && !isRegistered {
            stopCamera()
            status = "Registration ended. Connect Glasses again."
        }
    }

    func register() async {
        guard !isBusy else { return }
        isBusy = true
        errorMessage = ""
        status = "Complete the connection in Meta AI, then return here."
        defer { isBusy = false }
        do {
            try await Wearables.shared.startRegistration()
            updateRegistration(Wearables.shared.registrationState)
            if isRegistered { status = "Connected. Start the glasses camera." }
        } catch {
            errorMessage = "Registration: \(error.localizedDescription)"
            status = "Could not connect. Check Developer Mode in Meta AI."
        }
    }

    func handleCallback(_ url: URL) async {
        guard url.scheme == "btcovision",
              URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.contains(where: { $0.name == "metaWearablesAction" }) == true
        else { return }
        do {
            _ = try await Wearables.shared.handleUrl(url)
            updateRegistration(Wearables.shared.registrationState)
        } catch {
            errorMessage = "Meta callback: \(error.localizedDescription)"
        }
    }

    func startCamera() async {
        guard isRegistered, !isBusy, session == nil else { return }
        isBusy = true
        errorMessage = ""
        frame = nil
        let attempt = UUID()
        generation = attempt
        status = "Checking glasses camera permission…"
        do {
            let wearables = Wearables.shared
            if try await wearables.checkPermissionStatus(.camera) != .granted {
                status = "Allow camera access in Meta AI, then return here."
                guard try await wearables.requestPermission(.camera) == .granted else {
                    isBusy = false
                    status = "Camera permission was not granted."
                    return
                }
            }
            guard generation == attempt else { return }
            let newSelector = AutoDeviceSelector(wearables: wearables)
            selector = newSelector
            let newSession = try wearables.createSession(deviceSelector: newSelector)
            session = newSession
            hasSession = true
            status = "Connecting to glasses…"
            cameraTokens.append(newSession.statePublisher.listen { [weak self] state in
                Task { @MainActor in
                    guard let self, self.generation == attempt else { return }
                    self.sessionChanged(state)
                }
            })
            cameraTokens.append(newSession.errorPublisher.listen { [weak self] error in
                Task { @MainActor in
                    guard let self, self.generation == attempt else { return }
                    self.errorMessage = "Glasses session: \(error.localizedDescription)"
                    if error != .dwaOutOfStuRange {
                        self.stopCamera()
                        self.status = "Glasses connection stopped. See the error below."
                    }
                }
            })
            try newSession.start()
            timeoutTask = Task { [weak self] in
                do { try await Task.sleep(nanoseconds: 30_000_000_000) }
                catch { return }
                guard let self, self.generation == attempt, !self.isLive else { return }
                self.stopCamera()
                self.status = "No camera frames received."
                self.errorMessage = "Check that the glasses are on, worn, paired in Meta AI, and in Developer Mode. Then try Start Glasses Camera again."
            }
        } catch {
            guard generation == attempt else { return }
            stopCamera()
            status = "Could not start the glasses camera."
            errorMessage = error.localizedDescription
        }
    }

    private func sessionChanged(_ state: DeviceSessionState) {
        switch state {
        case .started:
            if camera == nil { attachCamera() }
        case .paused:
            isLive = false
            status = "Glasses paused. Put them on with the arms open."
        case .stopped:
            stopCamera()
            status = "Glasses disconnected. Start the camera again."
        case .starting: status = "Connecting to glasses…"
        case .stopping:
            isLive = false
            status = "Stopping glasses camera…"
        case .idle: break
        @unknown default: break
        }
    }

    private func attachCamera() {
        guard let session, session.state == .started, camera == nil else { return }
        let attempt = generation
        do {
            let config = StreamConfiguration(videoCodec: .raw, resolution: .high, frameRate: 7)
            guard let newCamera = try session.addCamera(config: config) else {
                stopCamera()
                errorMessage = "Could not attach the glasses camera. Try starting again."
                return
            }
            camera = newCamera
            let stream = newCamera.stream
            cameraTokens.append(stream.statePublisher.listen { [weak self] state in
                Task { @MainActor in
                    guard let self, self.generation == attempt else { return }
                    self.streamChanged(state)
                }
            })
            cameraTokens.append(stream.videoFramePublisher.listen { [weak self] videoFrame in
                // Decode on the SDK callback queue; hand only the image to the UI.
                guard let image = videoFrame.makeUIImage() else { return }
                Task { @MainActor in
                    guard let self, self.generation == attempt,
                          self.session?.state == .started, self.streamIsRunning else { return }
                    self.frame = image
                    self.isLive = true
                    self.isBusy = false
                    self.status = "Live from your glasses. Ready to scan cards."
                    self.timeoutTask?.cancel()
                    self.timeoutTask = nil
                }
            })
            cameraTokens.append(stream.errorPublisher.listen { [weak self] error in
                Task { @MainActor in
                    guard let self, self.generation == attempt else { return }
                    self.stopCamera()
                    self.status = "Glasses camera stopped."
                    self.errorMessage = "Camera: \(error.localizedDescription)"
                }
            })
            status = "Starting glasses video…"
            stream.start()
        } catch {
            stopCamera()
            errorMessage = "Camera setup: \(error.localizedDescription)"
        }
    }

    private func streamChanged(_ state: StreamState) {
        streamIsRunning = state == .streaming
        switch state {
        case .streaming: status = "Waiting for the first glasses frame…"
        case .paused:
            isLive = false
            isBusy = false
            status = "Camera paused. Put on the glasses or restart the camera."
        case .stopped:
            stopCamera()
        case .starting: status = "Starting glasses video…"
        case .waitingForDevice: status = "Waiting for glasses…"
        case .stopping:
            isLive = false
            status = "Stopping glasses camera…"
        @unknown default: break
        }
    }

    func stopCamera() {
        generation = UUID() // Ignore callbacks queued by an earlier session.
        timeoutTask?.cancel()
        timeoutTask = nil
        let oldTokens = cameraTokens
        cameraTokens.removeAll()
        camera?.stop()
        session?.stop()
        camera = nil
        session = nil
        selector = nil
        streamIsRunning = false
        isLive = false
        isBusy = false
        hasSession = false
        frame = nil
        status = "Glasses camera stopped."
        Task { for token in oldTokens { await token.cancel() } }
    }
}
