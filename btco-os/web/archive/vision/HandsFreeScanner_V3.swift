import SwiftUI

import UIKit

import Vision

import AVFoundation

import Combine

import CoreImage

import AudioToolbox



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
                    ProgressView().tint(Color.blue)
                }

                if let result = scanner.result {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(result.card.player.isEmpty ? "CARD IDENTIFIED" : result.card.player)
                            .font(.title2.bold()).foregroundStyle(.white)
                        Text([result.card.year, result.card.manufacturer, result.card.set]
                            .filter { !$0.isEmpty }.joined(separator: " • "))
                            .foregroundStyle(.secondary)
                        if !result.card.cardNumber.isEmpty { Text("#\(result.card.cardNumber)").foregroundStyle(.white) }
                        Divider()
                        Text(result.inventoryText).foregroundStyle(result.inventoryFound ? Color.green : Color.secondary)
                        if let market = result.market {
                            Text("Active market median: \(money(market.median))").foregroundStyle(.white)
                            Text("Quick sale: \(money(market.quickSale)) • Suggested list: \(money(market.suggestedList))")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        if !result.warning.isEmpty {
                            Text(result.warning).font(.caption).foregroundStyle(Color.orange)
                        }
                    }
                    .padding()
                    .background(Color.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
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

    private func money(_ value: Double) -> String {
        value.formatted(.currency(code: "USD"))
    }

}

// MARK: - Hands-Free API Models

struct HFCardIdentification: Codable {
    let player, year, manufacturer, set, cardNumber: String
    let team, sport, parallel, serialNumber: String
    let rookie, autograph, relic, graded: Bool
    let gradingCompany, grade, confidence, notes: String
}

private struct HFScanResponse: Codable { let success: Bool; let card: HFCardIdentification }
private struct HFInventoryResponse: Codable { let success: Bool; let found: Bool; let exactMatchCount: Int; let candidateCount: Int; let matches: [HFInventoryMatch] }
private struct HFInventoryMatch: Codable { let title: String; let quantity: Int; let askingPrice: Double; let cabinet, shelf, box, row, section: String }
private struct HFCompResponse: Codable { let success: Bool; let warnings: [String]; let market: HFMarket; let relevantCount: Int }
struct HFMarket: Codable { let low, median, high, suggestedList, quickSale: Double; let confidence: String }

struct HFVisionResult {
    let card: HFCardIdentification
    let inventoryFound: Bool
    let inventoryText: String
    let market: HFMarket?
    let warning: String
}

enum HandsFreeState: Equatable {

    case searchingFront, collectingFront, waitingForFlip, collectingBack, ready, stopped



    var title: String {

        switch self {

        case .searchingFront: return "WATCHING"

        case .collectingFront: return "CARD DETECTED"

        case .waitingForFlip: return "FLIP CARD"

        case .collectingBack: return "BACK DETECTED"

        case .ready: return "CARD READY"

        case .stopped: return "PAUSED"

        }

    }



    var icon: String {

        switch self {

        case .searchingFront: return "eye.fill"

        case .collectingFront, .collectingBack: return "viewfinder"

        case .waitingForFlip: return "arrow.triangle.2.circlepath"

        case .ready: return "checkmark.circle.fill"

        case .stopped: return "pause.circle.fill"

        }

    }



    var color: Color {

        switch self {

        case .searchingFront: return .blue

        case .collectingFront, .collectingBack: return .yellow

        case .waitingForFlip: return .orange

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

    @Published var isProcessing = false
    @Published var result: HFVisionResult?

    private let serverBase = "http://192.168.4.50:3000"



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
    private let minimumSharpness = 18.0



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



    func reset() {

        frontImage = nil; backImage = nil; frontSignature = nil; result = nil; isProcessing = false

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

        case .ready, .stopped: break

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

        case .ready:
            if missedFrames >= 8 && !isProcessing {
                frontImage = nil; backImage = nil; frontSignature = nil; result = nil
                candidates.removeAll(); presentFrames = 0; changedFrames = 0; captureProgress = 0
                state = .searchingFront; updateStatus()
            }
        case .stopped: break

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

        guard best.sharpness >= minimumSharpness else {
            if candidates.count > candidateTarget * 2 { candidates.removeFirst(candidateTarget) }
            statusText = isBack ? "Back is blurry — hold closer…" : "Front is blurry — hold closer…"
            return
        }

        candidates.removeAll(); captureProgress = 0; presentFrames = 0; missedFrames = 0



        if isBack {

            backImage = best.image

            state = .ready
            statusText = "Captured — identifying…"
            feedback(1520)

            let front = frontImage
            let back = backImage
            Task { [weak self] in
                guard let self, let front, let back else { return }
                await self.identifyAndEnrich(front: front, back: back)
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



    // MARK: - BTCo Brain

    private func identifyAndEnrich(front: UIImage, back: UIImage) async {
        isProcessing = true
        defer { isProcessing = false }

        do {
            let card = try await identify(front: front, back: back)
            statusText = "Checking BTCo inventory…"

            async let inventoryTask = checkInventory(card)
            async let marketTask = findComps(card)
            let (inventory, comps) = try await (inventoryTask, marketTask)

            var inventoryText = inventory.found ? "Owned in BTCo inventory" : "Not in current BTCo inventory"
            if inventory.found, let first = inventory.matches.first {
                var details: [String] = []
                if first.quantity > 0 { details.append("Qty \(first.quantity)") }
                let location = [first.cabinet, first.shelf, first.box, first.row, first.section].filter { !$0.isEmpty }.joined(separator: " • ")
                if !location.isEmpty { details.append(location) }
                if !details.isEmpty { inventoryText += " — " + details.joined(separator: " • ") }
            }

            result = HFVisionResult(
                card: card,
                inventoryFound: inventory.found,
                inventoryText: inventoryText,
                market: comps.market,
                warning: comps.warnings.joined(separator: " ")
            )
            statusText = "Result ready — remove card for next scan."
            feedback(1520)
        } catch {
            statusText = "BTCo scan failed: \(error.localizedDescription)"
            feedback(1073)
        }
    }

    private func identify(front: UIImage, back: UIImage) async throws -> HFCardIdentification {
        guard let url = URL(string: "\(serverBase)/scan-card"),
              let frontData = front.jpegData(compressionQuality: 0.82),
              let backData = back.jpegData(compressionQuality: 0.82) else {
            throw HFError.message("Could not prepare card images.")
        }

        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        appendImage(frontData, name: "front", filename: "front.jpg", boundary: boundary, to: &body)
        appendImage(backData, name: "back", filename: "back.jpg", boundary: boundary, to: &body)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(HFScanResponse.self, from: data).card
    }

    private func checkInventory(_ card: HFCardIdentification) async throws -> HFInventoryResponse {
        guard let url = URL(string: "\(serverBase)/check-inventory") else { throw HFError.message("Bad inventory URL.") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(card)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(HFInventoryResponse.self, from: data)
    }

    private func findComps(_ card: HFCardIdentification) async throws -> HFCompResponse {
        guard let url = URL(string: "\(serverBase)/find-comps") else { throw HFError.message("Bad comps URL.") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(card)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(HFCompResponse.self, from: data)
    }

    private func appendImage(_ data: Data, name: String, filename: String, boundary: String, to body: inout Data) {
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n".data(using: .utf8)!)
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw HFError.message("Invalid server response.") }
        guard (200...299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown server error"
            throw HFError.message("Server \(http.statusCode): \(message)")
        }
    }

    private func feedback(_ sound: SystemSoundID) {

        AudioServicesPlaySystemSound(sound)

    }

}



private enum HFError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let value): return value }
    }
}

#Preview {

    HandsFreeScanner()

}
