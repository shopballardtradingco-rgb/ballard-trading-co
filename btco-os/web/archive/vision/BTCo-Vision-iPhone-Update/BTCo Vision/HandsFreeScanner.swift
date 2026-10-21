import SwiftUI
import UIKit
import Vision
import AVFoundation
import Combine
import CoreImage
import AudioToolbox
struct PSAIntelligence: Codable {
    let success: Bool
    let verified: Bool
    let certNumber: String
    let specID: Int?
    let year: String?
    let brand: String?
    let category: String?
    let cardNumber: String?
    let subject: String?
    let variety: String?
    let gradeDescription: String?
    let cardGrade: String?
    let totalPopulation: Int?
    let populationHigher: Int?
    let itemStatus: String?
    let psaEstimate: Double?
    let cached: Bool?
    let fetchedAt: String?
    let callsUsedToday: Int?
    let callsRemainingToday: Int?
    let rateLimited: Bool?
    let quotaProtected: Bool?
    let retryAfter: String?
    let error: String?
}
struct PSAEnrichedScanResponse: Codable {
    let success: Bool
    let card: CardIdentification
    let psa: PSAIntelligence?
}
struct HandsFreeScanner: View {
    @StateObject private var camera = IPhoneCardCamera()
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var scanner = HandsFreeScannerEngine()
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            ScrollView {
            VStack(spacing: 16) {
                Text("BTCo Vision").font(.largeTitle.bold()).foregroundStyle(.white)
                Text("Whole-Card Scan • iPhone").font(.headline).foregroundStyle(.secondary)
                if let image = scanner.previewImage {
                    CardCameraPreview(image: image, outline: scanner.outline,
                                      color: scanner.state == .waitingForFlip ? .green : .yellow)
                        .padding(.horizontal)
                } else {
                    Spacer()
                    Image(systemName: "viewfinder.circle").font(.system(size: 100)).foregroundStyle(.secondary)
                    Spacer()
                }
                if scanner.outline != nil && (scanner.state == .collectingFront || scanner.state == .collectingBack) {
                    Label("CARD FOUND", systemImage: "rectangle.dashed")
                        .font(.caption.bold()).foregroundStyle(.green)
                }
                Image(systemName: scanner.state.icon)
                    .font(.system(size: 34)).foregroundStyle(scanner.state.color)
                Text(scanner.state.title).font(.title2.bold()).foregroundStyle(.white)
                Text(scanner.statusText).font(.subheadline).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).padding(.horizontal)
                if scanner.isRunning && scanner.isCapturePhase {
                    Button(scanner.frontImage == nil ? "Capture front now" : "Capture back now") {
                        scanner.captureNow()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(camera.frame == nil || scanner.previewImage == nil)
                    Text("Auto-captures after a brief pause. Tap to capture immediately.")
                        .font(.caption).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center).padding(.horizontal)
                }
                if scanner.isProcessing {
                    VStack(spacing: 8) {
                        ProgressView()
                        Text(scanner.backendStage.isEmpty ? "Working…" : scanner.backendStage)
                            .font(.headline)
                            .foregroundStyle(.white)
                    }
                    .padding()
                }
                if let card = scanner.identifiedCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(card.player.isEmpty ? "Unknown Card" : card.player)
                            .font(.title2.bold()).foregroundStyle(.white)
                        Text([card.year, card.manufacturer, card.set]
                            .filter { !$0.isEmpty }.joined(separator: " • "))
                            .font(.subheadline).foregroundStyle(.secondary)
                        if !card.cardNumber.isEmpty {
                            Text("#\(card.cardNumber)").font(.headline).foregroundStyle(.white)
                        }
                        if card.graded {
                            HStack(spacing: 8) {
                                Image(systemName: "checkmark.seal.fill")
                                Text([card.gradingCompany, card.grade]
                                    .filter { !$0.isEmpty }
                                    .joined(separator: " "))
                                    .font(.headline.bold())
                            }
                            .foregroundStyle(Color.yellow)
                        }
                        if let psa = scanner.psaResult {
                            if psa.verified {
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Label("PSA VERIFIED", systemImage: "checkmark.shield.fill")
                                            .font(.headline.bold()).foregroundStyle(Color.green)
                                        Spacer()
                                        if psa.cached == true {
                                            Text("CACHED").font(.caption2.bold()).foregroundStyle(.secondary)
                                        }
                                    }
                                    Text("Cert #\(psa.certNumber)")
                                        .font(.subheadline).foregroundStyle(.secondary)
                                    if let estimate = psa.psaEstimate, estimate > 0 {
                                        HStack {
                                            Text("PSA Estimate").foregroundStyle(.secondary)
                                            Spacer()
                                            Text(estimate.formatted(.currency(code: "USD")))
                                                .font(.headline.bold()).foregroundStyle(.white)
                                        }
                                    }
                                    HStack {
                                        if let pop = psa.totalPopulation { Text("POP \(pop)") }
                                        if let higher = psa.populationHigher { Text("• \(higher) higher") }
                                    }.font(.caption).foregroundStyle(.secondary)
                                }.padding(.vertical, 4)
                            } else if psa.rateLimited == true || psa.quotaProtected == true {
                                Text("PSA lookup paused — BTCo data still available.")
                                    .font(.caption).foregroundStyle(Color.orange)
                            }
                        }
                        if let inventory = scanner.inventoryResult {
                            Text(inventory.found ? "📦 IN BTCo INVENTORY" : "📦 NOT IN INVENTORY")
                                .font(.headline)
                                .foregroundStyle(inventory.found ? Color.green : Color.orange)
                        }
                        if let comps = scanner.compsResult, comps.market.median > 0 {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(card.graded ? "GRADED ACTIVE MEDIAN" : "ACTIVE MEDIAN")
                                        .font(.caption2).foregroundStyle(.secondary)
                                    Text(comps.market.median.formatted(.currency(code: "USD")))
                                        .font(.title3.bold()).foregroundStyle(.white)
                                }
                                Spacer()
                                VStack(alignment: .trailing) {
                                    Text("QUICK SALE").font(.caption2).foregroundStyle(.secondary)
                                    Text(comps.market.quickSale.formatted(.currency(code: "USD")))
                                        .font(.title3.bold()).foregroundStyle(.white)
                                }
                            }
                        }
                    }
                    .padding()
                    .background(.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .padding(.horizontal)
                }
                if !camera.errorMessage.isEmpty {
                    Text(camera.errorMessage).font(.caption).foregroundStyle(.red)
                        .padding(.horizontal)
                }
                if !scanner.backendError.isEmpty {
                    Text(scanner.backendError)
                        .font(.caption)
                        .foregroundStyle(Color.red)
                        .padding(.horizontal)
                }
                if scanner.state == .collectingFront || scanner.state == .collectingBack {
                    ProgressView(value: scanner.captureProgress).tint(.green).padding(.horizontal, 48)
                }
                HStack(spacing: 22) {
                    thumb("FRONT", scanner.frontImage)
                    thumb("BACK", scanner.backImage)
                }.padding(.horizontal)
                if scanner.state == .waitingForFlip {
                    Button("Back is showing") { scanner.backIsShowing() }
                        .buttonStyle(.bordered)
                    Text("Use this if the scanner does not recognize the flip.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if scanner.state == .result || scanner.state == .ready {
                    Button("Scan Next") { scanner.scanAnotherCard() }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                    if scanner.identifiedCard == nil {
                        Button("Retry Identification") { scanner.retryIdentification() }
                            .buttonStyle(.bordered)
                    }
                }
                Toggle("Sound and spoken feedback", isOn: $scanner.soundEnabled)
                    .padding(.horizontal).foregroundStyle(.white)
                HStack(spacing: 20) {
                    Button("Reset") { scanner.reset() }.buttonStyle(.bordered)
                    Button(scanner.isRunning ? "Stop" : "Start") { scanner.toggle() }
                        .buttonStyle(.borderedProminent)
                        .disabled(scanner.isProcessing)
                }.padding(.bottom)
            }
        }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else {
                camera.stop()
                scanner.clearPendingFrames()
                return
            }
            scanner.start()
            await camera.start()
        }
        .onReceive(camera.$frame) { image in
            guard scenePhase == .active, let image else { return }
            scanner.processFrame(image)
        }
        .onDisappear {
            camera.stop()
            scanner.shutdown()
        }
    }
    @ViewBuilder
    private func thumb(_ title: String, _ image: UIImage?) -> some View {
        VStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
                    .frame(width: 85, height: 115).clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 9))
            } else {
                RoundedRectangle(cornerRadius: 9).fill(.white.opacity(0.08))
                    .frame(width: 85, height: 115)
            }
            Text(title).font(.caption.bold())
                .foregroundStyle(image == nil ? Color.secondary : Color.green)
        }.frame(maxWidth: .infinity)
    }
}
enum HandsFreeState: Equatable {
    case searchingFront, collectingFront, waitingForFlip, collectingBack, identifying, result, ready, stopped
    var title: String {
        switch self {
        case .searchingFront: return "SHOW FRONT"
        case .collectingFront: return "HOLD STEADY"
        case .waitingForFlip: return "FRONT CAPTURED"
        case .collectingBack: return "HOLD BACK STEADY"
        case .identifying: return "CAPTURED"
        case .result: return "RESULT"
        case .ready: return "CARD READY"
        case .stopped: return "PAUSED"
        }
    }
    var icon: String {
        switch self {
        case .searchingFront: return "eye.fill"
        case .collectingFront, .collectingBack: return "viewfinder"
        case .waitingForFlip: return "arrow.triangle.2.circlepath"
        case .identifying: return "brain.head.profile"
        case .result: return "checkmark.seal.fill"
        case .ready: return "checkmark.circle.fill"
        case .stopped: return "pause.circle.fill"
        }
    }
    var color: Color {
        switch self {
        case .searchingFront: return .blue
        case .collectingFront, .collectingBack: return .yellow
        case .waitingForFlip: return .orange
        case .identifying: return Color.purple
        case .result: return Color.green
        case .ready: return Color.green
        case .stopped: return .secondary
        }
    }
}
private struct CardCandidate: @unchecked Sendable {
    let image: UIImage
    let sharpness: Double
    let signature: UInt64
}

struct CardOutline: Sendable {
    let bounds: CGRect
    let corners: [CGPoint]

    nonisolated func isSteady(comparedTo other: CardOutline) -> Bool {
        let scale = max(hypot(other.bounds.width, other.bounds.height), 0.01)
        let area = bounds.width * bounds.height
        let oldArea = max(other.bounds.width * other.bounds.height, 0.0001)
        guard abs(area / oldArea - 1) < 0.40 else { return false }
        return zip(corners, other.corners).allSatisfy { a, b in
            hypot(a.x - b.x, a.y - b.y) / scale < 0.22
        }
    }
}

private struct CardFrameInput: @unchecked Sendable {
    let image: UIImage
    let previous: CGRect?
}

private struct CardFrameResult: @unchecked Sendable {
    let preview: UIImage
    let outline: CardOutline?
    let candidate: CardCandidate?
    let hint: String
}

private final class CardVisionWorker: @unchecked Sendable {
    nonisolated(unsafe) private let context: CIContext
    nonisolated init() { context = CIContext() }

    nonisolated func analyze(_ input: CardFrameInput) -> CardFrameResult {
        // Normalize rotation so Vision and the drawn outline use the same coordinates.
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: input.image.size, format: format).image { _ in
            input.image.draw(in: CGRect(origin: .zero, size: input.image.size))
        }
        func result(_ hint: String, shape: CardOutline? = nil,
                    candidate: CardCandidate? = nil) -> CardFrameResult {
            CardFrameResult(preview: image, outline: shape, candidate: candidate, hint: hint)
        }
        guard let cg = image.cgImage else {
            return result("Waiting for a camera frame…")
        }
        let request = VNDetectRectanglesRequest()
        request.maximumObservations = 0
        request.minimumConfidence = 0.65
        request.minimumAspectRatio = 0.50
        request.maximumAspectRatio = 0.88
        request.minimumSize = 0.08
        request.quadratureTolerance = 30
        do {
            try VNImageRequestHandler(cgImage: cg, orientation: .up).perform([request])
        } catch {
            return result("Could not inspect this frame. Hold the card in view.")
        }
        var rectangles: [VNRectangleObservation] = []
        for rect in request.results ?? [] {
            if isCardSized(rect, width: cg.width, height: cg.height) {
                rectangles.append(rect)
            }
        }
        rectangles.sort { a, b in
            let areaA = a.boundingBox.width * a.boundingBox.height
            let areaB = b.boundingBox.width * b.boundingBox.height
            return areaA > areaB
        }
        // Remove inner artwork, labels, and borders when an enclosing card exists.
        var outerRectangles: [VNRectangleObservation] = []
        for rect in rectangles {
            var nested = false
            for outer in outerRectangles {
                if encloses(outer, rect) {
                    nested = true
                    break
                }
            }
            if !nested { outerRectangles.append(rect) }
        }
        guard !outerRectangles.isEmpty else {
            return result("Looking for the whole card. Keep its outside edges visible.")
        }
        // Prefer the largest enclosing boundary, even if the old target was tiny.
        var selected = outerRectangles[0]
        if let previous = input.previous {
            for rect in outerRectangles {
                let box = rect.boundingBox
                let containsPrevious = box.contains(previous)
                if containsPrevious || overlap(box, previous) > 0.15 {
                    selected = rect
                    break
                }
            }
        }
        let rect = selected
        let b = rect.boundingBox
        let shape = CardOutline(bounds: b,
                                corners: [rect.topLeft, rect.topRight, rect.bottomRight, rect.bottomLeft])
        let ci = CIImage(cgImage: cg)
        func point(_ p: CGPoint) -> CIVector {
            CIVector(x: p.x * CGFloat(cg.width), y: p.y * CGFloat(cg.height))
        }
        let corrected = ci.applyingFilter("CIPerspectiveCorrection", parameters: [
            "inputTopLeft": point(rect.topLeft), "inputTopRight": point(rect.topRight),
            "inputBottomRight": point(rect.bottomRight), "inputBottomLeft": point(rect.bottomLeft)
        ])
        guard !corrected.extent.isEmpty, !corrected.extent.isInfinite,
              let crop = context.createCGImage(corrected, from: corrected.extent) else {
            return result("Card found — turn it a little more toward the camera.", shape: shape)
        }
        // Identify from the complete frame. An imperfect outline must not discard
        // the player's name, the set, the card number, or the slab label.
        let candidate = CardCandidate(image: image, sharpness: sharpness(crop, context),
                                      signature: signature(crop, context))
        return result("Card boundary found — pause briefly.", shape: shape, candidate: candidate)
    }

    nonisolated private func isCardSized(
        _ rect: VNRectangleObservation, width: Int, height: Int
    ) -> Bool {
        let box = rect.boundingBox
        let area = box.width * box.height
        guard area >= 0.018, area < 0.80,
              box.minX > 0.003, box.minY > 0.003,
              box.maxX < 0.997, box.maxY < 0.997 else { return false }
        func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
            let dx = (a.x - b.x) * CGFloat(width)
            let dy = (a.y - b.y) * CGFloat(height)
            return hypot(dx, dy)
        }
        let top = distance(rect.topLeft, rect.topRight)
        let bottom = distance(rect.bottomLeft, rect.bottomRight)
        let left = distance(rect.topLeft, rect.bottomLeft)
        let right = distance(rect.topRight, rect.bottomRight)
        let sideA = (top + bottom) / 2
        let sideB = (left + right) / 2
        let shorter = min(sideA, sideB)
        let longer = max(sideA, sideB)
        guard shorter >= 90, longer > 0 else { return false }
        let ratio = shorter / longer
        return ratio >= 0.54 && ratio <= 0.82
    }

    nonisolated private func encloses(
        _ outer: VNRectangleObservation, _ inner: VNRectangleObservation
    ) -> Bool {
        let a = outer.boundingBox
        let b = inner.boundingBox
        let outerArea = a.width * a.height
        let innerArea = b.width * b.height
        guard outerArea > innerArea * 1.08 else { return false }
        let boundary = [outer.topLeft, outer.topRight, outer.bottomRight, outer.bottomLeft]
        let points = [inner.topLeft, inner.topRight, inner.bottomRight, inner.bottomLeft]
        for point in points {
            if !isInside(point, boundary: boundary) { return false }
        }
        return true
    }

    nonisolated private func isInside(_ point: CGPoint, boundary: [CGPoint]) -> Bool {
        var hasPositive = false
        var hasNegative = false
        for i in 0..<4 {
            let a = boundary[i]
            let b = boundary[(i + 1) % 4]
            let dx = b.x - a.x
            let dy = b.y - a.y
            let cross = dx * (point.y - a.y) - dy * (point.x - a.x)
            let tolerance = hypot(dx, dy) * 0.004
            if cross > tolerance { hasPositive = true }
            if cross < -tolerance { hasNegative = true }
            if hasPositive && hasNegative { return false }
        }
        return true
    }

    nonisolated private func overlap(_ a: CGRect, _ b: CGRect) -> CGFloat {
        let intersection = a.intersection(b)
        guard !intersection.isNull else { return 0 }
        let area = intersection.width * intersection.height
        return area / max(a.width * a.height + b.width * b.height - area, 0.0001)
    }

    nonisolated private func sharpness(_ cg: CGImage, _ context: CIContext) -> Double {
        let ci = CIImage(cgImage: cg)
        let scale = 256 / max(ci.extent.width, ci.extent.height)
        let small = ci.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let edges = small.applyingFilter("CIEdges", parameters: [kCIInputIntensityKey: 1.0])
        let average = edges.applyingFilter("CIAreaAverage", parameters: [
            kCIInputExtentKey: CIVector(cgRect: edges.extent)
        ])
        var pixels = [UInt8](repeating: 0, count: 4)
        context.render(average, toBitmap: &pixels, rowBytes: 4,
                       bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
                       format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        return Double(pixels[0]) + Double(pixels[1]) + Double(pixels[2])
    }

    nonisolated private func signature(_ cg: CGImage, _ context: CIContext) -> UInt64 {
        let ci = CIImage(cgImage: cg)
        let small = ci.transformed(by: CGAffineTransform(scaleX: 8 / ci.extent.width,
                                                       y: 8 / ci.extent.height))
        var pixels = [UInt8](repeating: 0, count: 256)
        context.render(small, toBitmap: &pixels, rowBytes: 32,
                       bounds: CGRect(x: 0, y: 0, width: 8, height: 8),
                       format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        var gray = [Int](repeating: 0, count: 64)
        var total: Int = 0
        for i in 0..<64 {
            let offset: Int = i * 4
            let red: Int = Int(pixels[offset])
            let green: Int = Int(pixels[offset + 1])
            let blue: Int = Int(pixels[offset + 2])
            let sum: Int = red + green + blue
            let brightness: Int = sum / 3
            gray[i] = brightness
            total += brightness
        }
        let average: Int = total / 64
        var hash: UInt64 = 0
        for i in 0..<64 where gray[i] >= average { hash |= UInt64(1) << i }
        return hash
    }
}

private struct CardCameraPreview: View {
    let image: UIImage
    let outline: CardOutline?
    let color: Color

    var body: some View {
        GeometryReader { geometry in
            let scale = min(geometry.size.width / image.size.width,
                            geometry.size.height / image.size.height)
            let width = image.size.width * scale
            let height = image.size.height * scale
            let offsetX = (geometry.size.width - width) / 2
            let offsetY = (geometry.size.height - height) / 2
            ZStack {
                Image(uiImage: image).resizable().scaledToFit()
                    .frame(width: geometry.size.width, height: geometry.size.height)
                if let outline {
                    Path { path in
                        let points = outline.corners.map {
                            CGPoint(x: offsetX + $0.x * width,
                                    y: offsetY + (1 - $0.y) * height)
                        }
                        if let first = points.first {
                            path.move(to: first)
                            for point in points.dropFirst() { path.addLine(to: point) }
                            path.closeSubpath()
                        }
                    }
                    .stroke(color, style: StrokeStyle(lineWidth: 4, lineJoin: .round))
                }
            }
        }
        .frame(height: 350)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

@MainActor
final class HandsFreeScannerEngine: NSObject, ObservableObject {
    @Published var state: HandsFreeState = .searchingFront
    @Published var previewImage: UIImage?
    @Published var frontImage: UIImage?
    @Published var backImage: UIImage?
    @Published var statusText = "Hold a card naturally in view, then pause briefly."
    @Published var captureProgress = 0.0
    @Published var isRunning = false
    @Published var outline: CardOutline?
    @Published var soundEnabled = true
    @Published var identifiedCard: CardIdentification?
    @Published var inventoryResult: InventoryLookupResponse?
    @Published var compsResult: CompResponse?
    @Published var psaResult: PSAIntelligence?
    @Published var backendError = ""
    @Published var isProcessing = false
    @Published var backendStage = ""
    @Published var waitingForRemoval = false

    private let speechSynthesizer = AVSpeechSynthesizer()
    private let worker = CardVisionWorker()
    private var intelligenceTask: Task<Void, Never>?
    private var frameInFlight = false
    private var generation = UUID()
    private var lastDetection = Date.distantPast
    private var lastSeen = Date.distantPast
    private var anchor: CardOutline?
    private var anchorSignature: UInt64?
    private var steadySince: Date?
    private var previousGoodTime: Date?
    private var acceptedDuration = 0.0
    private var candidates: [CardCandidate] = []
    private var latestCandidate: CardCandidate?
    private var previewTime = Date.distantPast
    private var frontSignature: UInt64?
    private var frontBounds: CGRect?
    private var flipAllowedAt = Date.distantFuture
    private var changedFrames = 0
    private var resumedState: HandsFreeState = .searchingFront
    private let holdSeconds = 0.95
    private let detectionInterval = 0.10
    private let serverBase = "http://192.168.4.50:3000"

    var isCapturePhase: Bool {
        switch state {
        case .searchingFront, .collectingFront, .waitingForFlip, .collectingBack:
            return true
        default:
            return false
        }
    }

    func start() {
        guard !isRunning else { return }
        isRunning = true
        if state == .stopped { state = resumedState }
        clearHold()
        updateStatus()
    }

    func stop() {
        guard isRunning else { return }
        generation = UUID()
        resumedState = state == .collectingFront ? .searchingFront : state
        if state == .identifying {
            intelligenceTask?.cancel()
            intelligenceTask = nil
            isProcessing = false
            backendStage = ""
            resumedState = .ready
        }
        isRunning = false
        clearHold()
        outline = nil
        latestCandidate = nil
        previewTime = .distantPast
        speechSynthesizer.stopSpeaking(at: .immediate)
        state = .stopped
        updateStatus()
    }

    func shutdown() { stop() }
    func toggle() { isRunning ? stop() : start() }

    func clearPendingFrames() {
        if !isProcessing { generation = UUID() }
        clearHold()
        outline = nil
        previewImage = nil
        latestCandidate = nil
        previewTime = .distantPast
        changedFrames = 0
        if state == .collectingFront { state = .searchingFront }
        if state != .result && state != .identifying {
            statusText = "iPhone camera paused. Return to the app to continue."
        }
    }

    func scanAnotherCard() { reset() }

    func reset() {
        generation = UUID()
        intelligenceTask?.cancel()
        intelligenceTask = nil
        speechSynthesizer.stopSpeaking(at: .immediate)
        frontImage = nil
        backImage = nil
        frontSignature = nil
        frontBounds = nil
        identifiedCard = nil
        inventoryResult = nil
        compsResult = nil
        psaResult = nil
        backendError = ""
        backendStage = ""
        isProcessing = false
        waitingForRemoval = false
        changedFrames = 0
        outline = nil
        latestCandidate = nil
        previewImage = nil
        previewTime = .distantPast
        flipAllowedAt = .distantFuture
        lastDetection = .distantPast
        lastSeen = .distantPast
        clearHold()
        resumedState = .searchingFront
        state = isRunning ? .searchingFront : .stopped
        updateStatus()
    }

    func backIsShowing() {
        guard isRunning, state == .waitingForFlip else { return }
        generation = UUID()
        clearHold()
        state = .collectingBack
        latestCandidate = nil
        previewTime = .distantPast
        statusText = "Back selected — pause briefly."
    }

    func captureNow() {
        guard isRunning, isCapturePhase, !isProcessing else { return }
        guard let image = previewImage,
              Date().timeIntervalSince(previewTime) < 0.5 else {
            statusText = "Waiting for a fresh iPhone camera frame…"
            return
        }
        // Use the detected crop when available. Otherwise send the full frame.
        let selected = latestCandidate
        commitCapture(image: selected?.image ?? image,
                      signature: selected?.signature,
                      isBack: frontImage != nil)
    }

    func retryIdentification() {
        guard frontImage != nil, backImage != nil, !isProcessing else { return }
        intelligenceTask?.cancel()
        intelligenceTask = Task { await runCardIntelligence() }
    }

    private func clearHold() {
        steadySince = nil
        previousGoodTime = nil
        acceptedDuration = 0
        anchor = nil
        anchorSignature = nil
        candidates.removeAll()
        captureProgress = 0
    }

    private func updateStatus() {
        switch state {
        case .searchingFront: statusText = "Hold a card naturally in view, then pause briefly."
        case .collectingFront: statusText = "Card found — pause briefly. Small movements are okay."
        case .waitingForFlip:
            statusText = frontSignature == nil
                ? "Front captured. Flip the card, then tap Back is showing or Capture back now."
                : "Front captured. Flip the card and pause briefly."
        case .collectingBack: statusText = "Back found — pause briefly."
        case .identifying: statusText = "Both sides captured. You can put the card down."
        case .result: statusText = "Results stay here. Tap Scan Next when ready."
        case .ready: statusText = "Both sides captured. Ready to identify."
        case .stopped: statusText = "Scanner paused."
        }
    }

    func processFrame(_ image: UIImage) {
        guard isRunning else { return }
        guard isCapturePhase else { return }
        let now = Date()
        guard !frameInFlight, now.timeIntervalSince(lastDetection) >= detectionInterval else { return }
        lastDetection = now
        frameInFlight = true
        let token = generation
        let input = CardFrameInput(image: image, previous: outline?.bounds)
        let worker = worker
        Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) {
                worker.analyze(input)
            }.value
            guard let self else { return }
            self.frameInFlight = false
            guard self.generation == token, self.isRunning else { return }
            self.previewImage = result.preview
            self.previewTime = now
            self.latestCandidate = result.candidate
            self.apply(result, at: now)
        }
    }

    private func apply(_ result: CardFrameResult, at now: Date) {
        guard let detected = result.outline, let candidate = result.candidate else {
            outline = result.outline
            previousGoodTime = nil
            if now.timeIntervalSince(lastSeen) < 0.45,
               state == .collectingFront || state == .collectingBack {
                statusText = "Finding the edges… progress saved."
                return
            }
            clearHold()
            changedFrames = 0
            if state == .collectingFront { state = .searchingFront }
            statusText = state == .waitingForFlip
                ? "Front captured. Show the back, or tap Capture back now."
                : result.hint
            return
        }
        outline = detected
        if now.timeIntervalSince(lastSeen) > 0.45 { clearHold() }
        lastSeen = now

        switch state {
        case .searchingFront:
            state = .collectingFront
            beginHold(detected, candidate, now)
            statusText = "Card found — pause briefly."
        case .collectingFront:
            collect(detected, candidate, now, isBack: false)
        case .waitingForFlip:
            guard now >= flipAllowedAt else { return }
            guard let frontSignature else { return }
            if let frontBounds, isInnerDetail(detected.bounds, of: frontBounds) {
                changedFrames = 0
                outline = nil
                statusText = "Show the whole back — ignoring an inner detail."
                return
            }
            if (frontSignature ^ candidate.signature).nonzeroBitCount >= 20 {
                changedFrames += 1
            } else {
                changedFrames = 0
            }
            if changedFrames >= 3 {
                state = .collectingBack
                beginHold(detected, candidate, now)
                statusText = "Back found — pause briefly."
            } else {
                statusText = "Front captured. Flip the card, or tap Capture back now."
            }
        case .collectingBack:
            collect(detected, candidate, now, isBack: true)
        default: break
        }
    }

    private func beginHold(_ shape: CardOutline, _ candidate: CardCandidate, _ now: Date) {
        anchor = shape
        anchorSignature = candidate.signature
        steadySince = now
        previousGoodTime = now
        acceptedDuration = 0
        candidates = [candidate]
        captureProgress = 0
    }

    private func collect(_ shape: CardOutline, _ candidate: CardCandidate,
                         _ now: Date, isBack: Bool) {
        guard let anchor, let anchorSignature, let steadySince else {
            beginHold(shape, candidate, now)
            return
        }
        if isInnerDetail(shape.bounds, of: anchor.bounds) {
            candidates.removeAll()
            acceptedDuration = 0
            captureProgress = 0
            previousGoodTime = nil
            outline = nil
            statusText = "Looking for the outside edges — ignoring an inner detail."
            return
        }
        guard now.timeIntervalSince(steadySince) < 2.0,
              shape.isSteady(comparedTo: anchor),
              (anchorSignature ^ candidate.signature).nonzeroBitCount <= 20 else {
            beginHold(shape, candidate, now)
            statusText = "Following the card — pause briefly, or tap Capture now."
            return
        }
        if let previousGoodTime {
            let delta = now.timeIntervalSince(previousGoodTime)
            if delta <= 0.45 {
                acceptedDuration += min(delta, 0.20)
            }
        }
        previousGoodTime = now
        candidates.append(candidate)
        if candidates.count > 10 { candidates.removeFirst() }
        captureProgress = min(acceptedDuration / holdSeconds, 1)
        statusText = "Card found — choosing the clearest frame…"
        guard acceptedDuration >= holdSeconds, candidates.count >= 6,
              let best = candidates.max(by: { $0.sharpness < $1.sharpness }) else { return }
        commitCapture(image: best.image, signature: best.signature, isBack: isBack)
    }

    private func commitCapture(image: UIImage, signature: UInt64?, isBack: Bool) {
        let capturedBounds = outline?.bounds
        clearHold()
        generation = UUID()
        latestCandidate = nil
        previewTime = .distantPast
        outline = nil
        if isBack {
            backImage = image
            state = .ready
            updateStatus()
            captureCue("Back captured.")
            intelligenceTask = Task { await runCardIntelligence() }
        } else {
            frontImage = image
            frontSignature = signature
            frontBounds = signature == nil ? nil : capturedBounds
            changedFrames = 0
            flipAllowedAt = Date().addingTimeInterval(1.0)
            state = .waitingForFlip
            updateStatus()
            captureCue("Front captured. Flip the card.")
        }
    }

    private func isInnerDetail(_ current: CGRect, of previous: CGRect) -> Bool {
        let currentArea = current.width * current.height
        let previousArea = previous.width * previous.height
        guard currentArea > 0, currentArea < previousArea * 0.72 else { return false }
        let intersection = current.intersection(previous)
        guard !intersection.isNull else { return false }
        let coveredArea = intersection.width * intersection.height
        return coveredArea / currentArea > 0.88
    }

    private func captureCue(_ words: String) {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        guard soundEnabled else { return }
        AudioServicesPlaySystemSound(1057)
        speechSynthesizer.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: words)
        utterance.rate = 0.5
        speechSynthesizer.speak(utterance)
    }

    private func speakResult(_ card: CardIdentification) {
        guard soundEnabled else { return }
        var parts = [card.player, card.year, card.manufacturer, card.set].filter { !$0.isEmpty }
        if card.graded {
            parts.append("\(card.gradingCompany) \(card.grade)")
        }
        if let psa = psaResult, psa.verified {
            parts.append("PSA certificate verified.")
        }
        if let inventory = inventoryResult {
            parts.append(inventory.found ? "In BTCo inventory." : "Not in BTCo inventory.")
        }
        if let comps = compsResult, comps.market.median > 0 {
            parts.append("Active market median \(comps.market.median.formatted(.currency(code: "USD"))).")
            if comps.market.quickSale > 0 {
                parts.append("Quick sale \(comps.market.quickSale.formatted(.currency(code: "USD"))).")
            }
        }
        parts.append("Tap Scan Next when ready.")
        let utterance = AVSpeechUtterance(string: parts.joined(separator: " "))
        utterance.rate = 0.48
        speechSynthesizer.speak(utterance)
    }

    private func feedback(_ sound: SystemSoundID) {
        if soundEnabled { AudioServicesPlaySystemSound(sound) }
    }

    // MARK: - BTCo Brain
    private func runCardIntelligence() async {
        guard !Task.isCancelled else { return }
        guard let frontImage,
              let backImage,
              let frontData = frontImage.jpegData(compressionQuality: 0.82),
              let backData = backImage.jpegData(compressionQuality: 0.82),
              let scanURL = URL(string: "\(serverBase)/scan-card")
        else {
            backendError = "Could not prepare captured card images."
            state = .result
            return
        }
        isProcessing = true
        state = .identifying
        backendStage = "Identifying card…"
        updateStatus()
        backendError = ""
        do {
            let boundary = UUID().uuidString
            var request = URLRequest(url: scanURL)
            request.httpMethod = "POST"
            request.timeoutInterval = 90
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            var body = Data()
            appendText("auto", name: "scanMode", boundary: boundary, body: &body)
            appendText(
                "Detect raw trading cards and graded slabs. If a slab is visible, read the grading label carefully and return graded=true, gradingCompany, grade, player, year, manufacturer, set, cardNumber, parallel/variation, and certification number if the existing response model supports it. Never invent a grade.",
                name: "scanInstructions",
                boundary: boundary,
                body: &body
            )
            appendImage(frontData, name: "front", filename: "front.jpg", boundary: boundary, body: &body)
            appendImage(backData, name: "back", filename: "back.jpg", boundary: boundary, body: &body)
            body.append(Data("\r\n--\(boundary)--\r\n".utf8))
            request.httpBody = body
            let (data, response) = try await URLSession.shared.data(for: request)
            try Task.checkCancellation()
            try requireSuccess(response, data: data)
            let scan = try JSONDecoder().decode(PSAEnrichedScanResponse.self, from: data)
            guard scan.success else { throw URLError(.cannotParseResponse) }
            identifiedCard = scan.card
            psaResult = scan.psa
            backendStage = "Checking BTCo inventory…"
            let inventory = try? await lookupInventory(scan.card)
            try Task.checkCancellation()
            inventoryResult = inventory
            backendStage = "Checking active market…"
            let market = try? await lookupComps(scan.card)
            try Task.checkCancellation()
            compsResult = market
            isProcessing = false
            backendStage = ""
            state = .result
            waitingForRemoval = true
            updateStatus()
            speakResult(scan.card)
            feedback(1520)
        } catch {
            guard !Task.isCancelled else { return }
            isProcessing = false
            backendStage = ""
            backendError = error.localizedDescription
            state = .result
            waitingForRemoval = true
            statusText = "Could not load results. Retry Identification or tap Scan Next."
        }
    }
    private func lookupInventory(_ card: CardIdentification) async throws -> InventoryLookupResponse {
        guard let url = URL(string: "\(serverBase)/check-inventory") else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(card)
        let (data, response) = try await URLSession.shared.data(for: request)
        try requireSuccess(response, data: data)
        return try JSONDecoder().decode(InventoryLookupResponse.self, from: data)
    }
    private func lookupComps(_ card: CardIdentification) async throws -> CompResponse {
        guard let url = URL(string: "\(serverBase)/find-comps") else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(card)
        let (data, response) = try await URLSession.shared.data(for: request)
        try requireSuccess(response, data: data)
        return try JSONDecoder().decode(CompResponse.self, from: data)
    }
    private func requireSuccess(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200...299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown server error"
            throw NSError(domain: "BTCoVision", code: http.statusCode,
                          userInfo: [NSLocalizedDescriptionKey: "Server \(http.statusCode): \(message)"])
        }
    }
    private func appendText(
        _ value: String,
        name: String,
        boundary: String,
        body: inout Data
    ) {
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".utf8))
        body.append(Data(value.utf8))
        body.append(Data("\r\n".utf8))
    }
    private func appendImage(_ data: Data, name: String, filename: String,
                             boundary: String, body: inout Data) {
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n".utf8))
        body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n".utf8))
    }
}

@MainActor
final class IPhoneCardCamera: ObservableObject {
    @Published private(set) var frame: UIImage?
    @Published private(set) var errorMessage = ""
    private let capture = IPhoneCaptureSession()
    private var requested = false

    init() {
        capture.onFrame = { [weak self] image in
            Task { @MainActor in self?.frame = image }
        }
        capture.onError = { [weak self] message in
            Task { @MainActor in self?.errorMessage = message }
        }
    }

    func start() async {
        requested = true
        let allowed: Bool
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: allowed = true
        case .notDetermined: allowed = await AVCaptureDevice.requestAccess(for: .video)
        default: allowed = false
        }
        guard requested else { return }
        guard allowed else {
            errorMessage = "Allow camera access in Settings to scan cards."
            return
        }
        errorMessage = ""
        capture.start()
    }

    func stop() {
        requested = false
        capture.stop()
        frame = nil
    }
}

// Capture configuration and frame conversion run on a serial queue.
nonisolated final class IPhoneCaptureSession: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    var onFrame: (@Sendable (UIImage) -> Void)?
    var onError: (@Sendable (String) -> Void)?
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "com.ballardtradingco.camera")
    private let context = CIContext()
    private var configured = false
    private var lastFrame = Date.distantPast

    func start() {
        queue.async { [self] in
            if !configured {
                session.beginConfiguration()
                session.sessionPreset = .hd1920x1080
                guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                      let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
                    session.commitConfiguration()
                    onError?("The iPhone rear camera is unavailable.")
                    return
                }
                let output = AVCaptureVideoDataOutput()
                output.alwaysDiscardsLateVideoFrames = true
                output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
                guard session.canAddOutput(output) else {
                    session.commitConfiguration()
                    onError?("Could not configure camera video.")
                    return
                }
                session.addInput(input)
                session.addOutput(output)
                output.setSampleBufferDelegate(self, queue: queue)
                if let connection = output.connection(with: .video), connection.isVideoRotationAngleSupported(90) {
                    connection.videoRotationAngle = 90
                }
                do {
                    try device.lockForConfiguration()
                    if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
                    if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
                    device.unlockForConfiguration()
                } catch { onError?("Camera focus configuration: \(error.localizedDescription)") }
                session.commitConfiguration()
                configured = true
            }
            if !session.isRunning { session.startRunning() }
        }
    }

    func stop() {
        queue.async { [self] in
            if session.isRunning { session.stopRunning() }
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = Date()
        guard now.timeIntervalSince(lastFrame) >= 0.10,
              let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastFrame = now
        let source = CIImage(cvPixelBuffer: buffer)
        guard let image = context.createCGImage(source, from: source.extent) else { return }
        onFrame?(UIImage(cgImage: image))
    }
}
