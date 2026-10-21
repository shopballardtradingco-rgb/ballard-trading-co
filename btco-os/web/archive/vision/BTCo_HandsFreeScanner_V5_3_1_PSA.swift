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

    @StateObject private var scanner = HandsFreeScannerEngine()



    var body: some View {

        ZStack {

            Color.black.ignoresSafeArea()

            VStack(spacing: 16) {

                Text("BTCo Vision").font(.largeTitle.bold()).foregroundStyle(.white)

                Text("Hands-Free Mode").font(.headline).foregroundStyle(.secondary)



                if let image = scanner.previewImage {

                    Image(uiImage: image).resizable().scaledToFit()

                        .frame(maxHeight: 430)

                        .clipShape(RoundedRectangle(cornerRadius: 18))

                        .padding(.horizontal)

                } else {

                    Spacer()

                    Image(systemName: "viewfinder.circle").font(.system(size: 100)).foregroundStyle(.secondary)

                    Spacer()

                }



                Image(systemName: scanner.state.icon)

                    .font(.system(size: 34)).foregroundStyle(scanner.state.color)

                Text(scanner.state.title).font(.title2.bold()).foregroundStyle(.white)

                Text(scanner.statusText).font(.subheadline).foregroundStyle(.secondary)

                    .multilineTextAlignment(.center).padding(.horizontal)

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

                        if scanner.waitingForRemoval {
                            Divider()

                            Button {
                                scanner.scanAnotherCard()
                            } label: {
                                Label("Scan Another Card", systemImage: "arrow.right.circle.fill")
                                    .font(.headline)
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)

                            Text("Results stay here until you decide to scan another card.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding()
                    .background(.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
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



                HStack(spacing: 20) {

                    Button("Reset") { scanner.reset() }.buttonStyle(.bordered)

                    Button(scanner.isRunning ? "Stop" : "Start") { scanner.toggle() }

                        .buttonStyle(.borderedProminent)

                }.padding(.bottom)

            }

        }

        .task { scanner.start() }

        .onDisappear { scanner.stop() }

    }



    @ViewBuilder

    private func thumb(_ title: String, _ image: UIImage?) -> some View {

        VStack {

            if let image {

                Image(uiImage: image).resizable().scaledToFill()

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

        case .searchingFront: return "WATCHING"

        case .collectingFront: return "CARD DETECTED"

        case .waitingForFlip: return "FLIP CARD"

        case .collectingBack: return "BACK DETECTED"

        case .identifying: return "IDENTIFYING"
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



private struct CardCandidate {

    let image: UIImage

    let sharpness: Double

    let signature: UInt64

}



@MainActor

final class HandsFreeScannerEngine: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate {

    @Published var state: HandsFreeState = .searchingFront

    @Published var previewImage: UIImage?

    @Published var frontImage: UIImage?

    @Published var backImage: UIImage?

    @Published var statusText = "Looking for a trading card…"

    @Published var captureProgress = 0.0

    @Published var isRunning = false
    @Published var identifiedCard: CardIdentification?
    @Published var inventoryResult: InventoryLookupResponse?
    @Published var compsResult: CompResponse?
    @Published var psaResult: PSAIntelligence?
    @Published var backendError = ""
    @Published var isProcessing = false
    @Published var backendStage = ""
    @Published var waitingForRemoval = false

    private let speechSynthesizer = AVSpeechSynthesizer()



    private let session = AVCaptureSession()

    private let sessionQueue = DispatchQueue(label: "btco.session", qos: .userInitiated)

    private let videoQueue = DispatchQueue(label: "btco.frames", qos: .userInitiated)

    private var configured = false

    private var lastDetection = Date.distantPast

    private var presentFrames = 0

    private var missedFrames = 0

    private var changedFrames = 0

    private var candidates: [CardCandidate] = []

    private var frontSignature: UInt64?



    private let detectionInterval: TimeInterval = 0.12

    private let requiredPresence = 3

    private let candidateTarget = 7

    private let requiredFlip = 3

    private let flipThreshold = 15
    private let minimumSharpness = 55.0
    private let serverBase = "http://192.168.4.50:3000"



    func start() {

        guard !isRunning else { return }

        isRunning = true

        if !configured { configureCamera() }

        sessionQueue.async { [weak self] in

            guard let self, !self.session.isRunning else { return }

            self.session.startRunning()

        }

        if state == .stopped {

            state = frontImage == nil ? .searchingFront : (backImage == nil ? .waitingForFlip : .ready)

        }

        updateStatus()

    }



    func stop() {

        isRunning = false

        state = .stopped

        sessionQueue.async { [weak self] in

            guard let self, self.session.isRunning else { return }

            self.session.stopRunning()

        }

        updateStatus()

    }



    func toggle() { isRunning ? stop() : start() }



    func scanAnotherCard() {
        speechSynthesizer.stopSpeaking(at: .immediate)
        rearmForNextCard()
    }

    func reset() {

        frontImage = nil; backImage = nil; frontSignature = nil
        identifiedCard = nil; inventoryResult = nil; compsResult = nil; psaResult = nil
        backendError = ""; isProcessing = false
        backendStage = ""; waitingForRemoval = false

        candidates.removeAll(); presentFrames = 0; missedFrames = 0; changedFrames = 0

        captureProgress = 0

        state = isRunning ? .searchingFront : .stopped

        updateStatus()

    }



    private func updateStatus() {

        switch state {

        case .searchingFront: statusText = "Looking for a trading card…"

        case .collectingFront: statusText = "Capturing best front…"

        case .waitingForFlip: statusText = "Front captured — flip the card."

        case .collectingBack: statusText = "Capturing best back…"

        case .identifying: statusText = "Identifying card…"
        case .result: statusText = "Result ready — tap Scan Another Card when you’re ready."
        case .ready: statusText = "Front + back captured."

        case .stopped: statusText = "Hands-Free Mode paused."

        }

    }



    private func configureCamera() {

        guard !configured else { return }

        configured = true

        session.beginConfiguration()

        session.sessionPreset = .high

        defer { session.commitConfiguration() }



        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {

            statusText = "Rear camera unavailable."; return

        }



        do {

            let input = try AVCaptureDeviceInput(device: camera)

            if session.canAddInput(input) { session.addInput(input) }

        } catch {

            statusText = "Camera setup failed."; return

        }



        let output = AVCaptureVideoDataOutput()

        output.alwaysDiscardsLateVideoFrames = true

        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]

        output.setSampleBufferDelegate(self, queue: videoQueue)

        if session.canAddOutput(output) { session.addOutput(output) }



        if let c = output.connection(with: .video), c.isVideoRotationAngleSupported(90) {

            c.videoRotationAngle = 90

        }

    }



    nonisolated func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {

        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ci = CIImage(cvPixelBuffer: buffer)

        let context = CIContext()

        guard let cg = context.createCGImage(ci, from: ci.extent) else { return }

        let image = UIImage(cgImage: cg)

        Task { @MainActor [weak self] in self?.processFrame(image) }

    }



    private func processFrame(_ image: UIImage) {

        guard isRunning else { return }

        let now = Date()

        guard now.timeIntervalSince(lastDetection) >= detectionInterval else { return }

        lastDetection = now

        previewImage = image

        detectCard(in: image)

    }



    private func detectCard(in image: UIImage) {

        guard let cg = image.cgImage else { return }

        let request = VNDetectRectanglesRequest()

        request.maximumObservations = 4

        request.minimumConfidence = 0.50

        request.minimumAspectRatio = 0.50

        request.maximumAspectRatio = 0.85

        request.minimumSize = 0.10

        request.quadratureTolerance = 35



        do {

            try VNImageRequestHandler(cgImage: cg, orientation: .up).perform([request])

            guard let rect = chooseRectangle(request.results ?? []) else { cardMissing(); return }

            cardPresent(rect, image)

        } catch { cardMissing() }

    }



    private func cardPresent(_ rectangle: VNRectangleObservation, _ image: UIImage) {

        missedFrames = 0

        guard rectangle.boundingBox.width * rectangle.boundingBox.height >= 0.06 else { cardMissing(); return }



        switch state {

        case .searchingFront:

            presentFrames += 1

            captureProgress = min(Double(presentFrames) / Double(requiredPresence), 1)

            statusText = "Card found…"

            if presentFrames >= requiredPresence {

                candidates.removeAll(); captureProgress = 0

                state = .collectingFront; updateStatus()

            }

        case .collectingFront:

            collect(rectangle, image, false)

        case .waitingForFlip:

            detectFlip(rectangle, image)

        case .collectingBack:

            collect(rectangle, image, true)

        case .result:
            break
        case .identifying, .ready, .stopped:
            break

        }

    }



    private func cardMissing() {

        missedFrames += 1

        switch state {

        case .searchingFront:

            if missedFrames >= 2 {

                presentFrames = 0; captureProgress = 0; updateStatus()

            }

        case .collectingFront:

            if missedFrames >= 7 {

                candidates.removeAll(); presentFrames = 0; captureProgress = 0

                state = .searchingFront; statusText = "Card lost — looking again…"

            }

        case .waitingForFlip:

            statusText = "Flip the card…"

        case .collectingBack:

            if missedFrames >= 7 {

                candidates.removeAll(); changedFrames = 0; captureProgress = 0

                state = .waitingForFlip; statusText = "Show the back again…"

            }

        case .result:
            break
        case .identifying, .ready, .stopped:
            break

        }

    }



    private func collect(_ rectangle: VNRectangleObservation, _ image: UIImage, _ isBack: Bool) {

        guard let crop = cropCard(image, rectangle) else { return }

        candidates.append(CardCandidate(

            image: crop,

            sharpness: estimateSharpness(crop),

            signature: imageSignature(crop)

        ))

        captureProgress = min(Double(candidates.count) / Double(candidateTarget), 1)

        guard candidates.count >= candidateTarget,

              let best = candidates.max(by: { $0.sharpness < $1.sharpness }) else { return }



        candidates.removeAll(); captureProgress = 0; presentFrames = 0; missedFrames = 0



        if best.sharpness < minimumSharpness {
            candidates.removeAll()
            captureProgress = 0
            statusText = isBack
                ? "Back is blurry — hold it steady…"
                : "Front is blurry — hold it steady…"
            return
        }

        if isBack {

            backImage = best.image

            state = .ready

            updateStatus()

            feedback(1520)

            Task {
                await runCardIntelligence()
            }

        } else {

            frontImage = best.image

            frontSignature = best.signature

            changedFrames = 0

            state = .waitingForFlip

            updateStatus()

            feedback(1519)

        }

    }



    private func detectFlip(_ rectangle: VNRectangleObservation, _ image: UIImage) {

        guard let crop = cropCard(image, rectangle) else { return }

        guard let frontSignature else {

            candidates.removeAll(); state = .collectingBack; updateStatus(); return

        }



        let difference = hammingDistance(frontSignature, imageSignature(crop))

        if difference >= flipThreshold {

            changedFrames += 1

            statusText = "New side detected…"

        } else {

            changedFrames = max(0, changedFrames - 1)

            statusText = "Flip the card…"

        }



        if changedFrames >= requiredFlip {

            candidates.removeAll(); captureProgress = 0; missedFrames = 0

            state = .collectingBack; updateStatus(); feedback(1519)

        }

    }



    private func chooseRectangle(_ rectangles: [VNRectangleObservation]) -> VNRectangleObservation? {

        rectangles.max { rectangleScore($0) < rectangleScore($1) }

    }



    private func rectangleScore(_ r: VNRectangleObservation) -> Double {

        let b = r.boundingBox

        let area = b.width * b.height

        let dx = b.midX - 0.5, dy = b.midY - 0.5

        return area - sqrt(dx * dx + dy * dy) * 0.16

    }



    private func cropCard(_ image: UIImage, _ observation: VNRectangleObservation) -> UIImage? {

        guard let cg = image.cgImage else { return nil }

        let b = observation.boundingBox

        let w = CGFloat(cg.width), h = CGFloat(cg.height)



        var r = CGRect(

            x: b.minX * w,

            y: (1 - b.maxY) * h,

            width: b.width * w,

            height: b.height * h

        )



        let mx = r.width * 0.025, my = r.height * 0.025

        r = r.insetBy(dx: -mx, dy: -my)

            .intersection(CGRect(x: 0, y: 0, width: w, height: h))

            .integral



        guard r.width > 20, r.height > 20, let cropped = cg.cropping(to: r) else { return nil }

        return UIImage(cgImage: cropped)

    }



    // Lightweight edge-energy metric: enough to choose the sharpest of a short burst.

    private func estimateSharpness(_ image: UIImage) -> Double {

        guard let cg = image.cgImage else { return 0 }

        let input = CIImage(cgImage: cg)

        guard let filter = CIFilter(name: "CIEdges") else { return 0 }

        filter.setValue(input, forKey: kCIInputImageKey)

        filter.setValue(1.0, forKey: kCIInputIntensityKey)

        guard let output = filter.outputImage else { return 0 }



        let extent = output.extent

        let vector = CIVector(x: extent.origin.x, y: extent.origin.y, z: extent.size.width, w: extent.size.height)

        guard let avg = CIFilter(

            name: "CIAreaAverage",

            parameters: [kCIInputImageKey: output, kCIInputExtentKey: vector]

        )?.outputImage else { return 0 }



        var bitmap = [UInt8](repeating: 0, count: 4)

        CIContext().render(

            avg,

            toBitmap: &bitmap,

            rowBytes: 4,

            bounds: CGRect(x: 0, y: 0, width: 1, height: 1),

            format: .RGBA8,

            colorSpace: CGColorSpaceCreateDeviceRGB()

        )

        return Double(bitmap[0]) + Double(bitmap[1]) + Double(bitmap[2])

    }



    // 64-bit perceptual average hash used only to distinguish front vs back.

    private func imageSignature(_ image: UIImage) -> UInt64 {

        guard let cg = image.cgImage else { return 0 }

        let ci = CIImage(cgImage: cg)

        let scaleX = 8.0 / ci.extent.width

        let scaleY = 8.0 / ci.extent.height

        let small = ci.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))

            .applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0])



        var pixels = [UInt8](repeating: 0, count: 64 * 4)

        CIContext().render(

            small,

            toBitmap: &pixels,

            rowBytes: 8 * 4,

            bounds: CGRect(x: 0, y: 0, width: 8, height: 8),

            format: .RGBA8,

            colorSpace: CGColorSpaceCreateDeviceRGB()

        )



        var gray = [UInt8]()

        gray.reserveCapacity(64)

        for i in 0..<64 {

            let base = i * 4

            let value = (Int(pixels[base]) + Int(pixels[base + 1]) + Int(pixels[base + 2])) / 3

            gray.append(UInt8(value))

        }

        let average = gray.reduce(0) { $0 + Int($1) } / 64



        var hash: UInt64 = 0

        for (i, value) in gray.enumerated() where Int(value) >= average {

            hash |= UInt64(1) << UInt64(i)

        }

        return hash

    }



    private func hammingDistance(_ a: UInt64, _ b: UInt64) -> Int {

        (a ^ b).nonzeroBitCount

    }




    // MARK: - Continuous Result Loop

    private func rearmForNextCard() {
        speechSynthesizer.stopSpeaking(at: .immediate)
        frontImage = nil
        backImage = nil
        frontSignature = nil
        identifiedCard = nil
        inventoryResult = nil
        compsResult = nil
        psaResult = nil
        backendError = ""
        backendStage = ""
        isProcessing = false
        waitingForRemoval = false
        candidates.removeAll()
        presentFrames = 0
        missedFrames = 0
        changedFrames = 0
        captureProgress = 0
        state = isRunning ? .searchingFront : .stopped
        updateStatus()
        feedback(1519)
    }

    private func speakResult(_ card: CardIdentification) {
        var parts: [String] = []
        if !card.player.isEmpty { parts.append(card.player) }

        let identity = [card.year, card.manufacturer, card.set]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        if !identity.isEmpty { parts.append(identity) }

        if card.graded {
            let slab = [card.gradingCompany, card.grade]
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            if !slab.isEmpty { parts.append(slab + ".") }
        }

        if let psa = psaResult, psa.verified {
            parts.append("PSA cert \(psa.certNumber) verified.")
            if let estimate = psa.psaEstimate, estimate > 0 {
                parts.append("PSA estimate \(spokenMoney(estimate)).")
            }
        }

        if let inventory = inventoryResult {
            parts.append(inventory.found ? "In BTCo inventory." : "Not in BTCo inventory.")
        }

        if let comps = compsResult, comps.market.median > 0 {
            parts.append("Active market median \(spokenMoney(comps.market.median)).")
            if comps.market.quickSale > 0 {
                parts.append("Quick sale \(spokenMoney(comps.market.quickSale)).")
            }
        }

        parts.append("Tap Scan Another Card when you are ready.")

        let utterance = AVSpeechUtterance(string: parts.joined(separator: " "))
        utterance.rate = 0.48
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        speechSynthesizer.speak(utterance)
    }

    private func spokenMoney(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        return formatter.string(from: NSNumber(value: value)) ?? "$\(value)"
    }

    // MARK: - BTCo Brain

    private func runCardIntelligence() async {
        guard let frontImage,
              let backImage,
              let frontData = frontImage.jpegData(compressionQuality: 0.82),
              let backData = backImage.jpegData(compressionQuality: 0.82),
              let scanURL = URL(string: "\(serverBase)/scan-card")
        else {
            backendError = "Could not prepare captured card images."
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
            try requireSuccess(response, data: data)

            let scan = try JSONDecoder().decode(PSAEnrichedScanResponse.self, from: data)
            identifiedCard = scan.card
            psaResult = scan.psa

            backendStage = "Checking BTCo inventory…"
            inventoryResult = try? await lookupInventory(scan.card)

            backendStage = "Checking active market…"
            compsResult = try? await lookupComps(scan.card)

            isProcessing = false
            backendStage = ""
            state = .result
            waitingForRemoval = true
            updateStatus()
            speakResult(scan.card)
            feedback(1520)
        } catch {
            isProcessing = false
            backendStage = ""
            backendError = error.localizedDescription
            state = .result
            waitingForRemoval = true
            statusText = "Could not load intelligence — move to the next card."
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

    private func feedback(_ sound: SystemSoundID) {

        AudioServicesPlaySystemSound(sound)

    }

}



#Preview {

    HandsFreeScanner()

}
