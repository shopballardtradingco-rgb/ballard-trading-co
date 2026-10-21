import SwiftUI
import UIKit

struct CardIdentification: Codable {
    let player, year, manufacturer, set, cardNumber: String
    let team, sport, parallel, serialNumber: String
    let rookie, autograph, relic, graded: Bool
    let gradingCompany, grade, confidence, notes: String
}
struct ScanResponse: Codable { let success: Bool; let card: CardIdentification }
struct InventoryLookupResponse: Codable {
    let success, found: Bool; let exactMatchCount: Int; let strongMatchCount: Int?
    let candidateCount, bestScore: Int; let matches: [InventoryMatch]
}
struct InventoryMatch: Codable, Identifiable {
    let id, sku, title, player, year, set, number, team, sport: String
    let quantity: Int; let askingPrice, purchasePrice: Double
    let status, cabinet, shelf, box, row, section: String
    let ebayStatus: String; let ebayQuantity: Int
    let collxStatus: String; let collxQuantity: Int
    let whatnotStatus: String; let whatnotQuantity: Int
    let matchScore: Int; let matchReasons: [String]
}
struct CompResponse: Codable {
    let success: Bool; let source: String; let soldData: Bool; let query: String
    let warnings: [String]; let resultCount, relevantCount, pricingCount: Int
    let market: CompMarket; let listings: [CompListing]
}
struct CompMarket: Codable { let low, median, high, suggestedList, quickSale: Double; let confidence: String }
struct CompListing: Codable, Identifiable {
    let itemId, title: String; let price, shipping, deliveredPrice: Double; let condition: String
    let buyingOptions: [String]; let itemWebUrl, image, seller: String; let score: Int
    let reasons, conflicts: [String]; var id: String { itemId }
}

struct ContentView: View {
    @State private var showCamera = false
    @State private var captureFront = true
    @State private var frontImage: UIImage?
    @State private var backImage: UIImage?
    @State private var card: CardIdentification?
    @State private var isScanning = false
    @State private var errorMessage = ""
    @State private var inventoryResult: InventoryLookupResponse?
    @State private var isCheckingInventory = false
    @State private var inventoryError = ""
    @State private var comps: CompResponse?
    @State private var isFindingComps = false
    @State private var compsError = ""
    private let server = "http://192.168.4.50:3000"

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Text("BTCo Vision").font(.largeTitle.bold())
                    Text("AI Card Intelligence").foregroundStyle(.secondary)
                    if let card { resultView(card) } else { scannerView }
                }.padding(.vertical)
            }
            .sheet(isPresented: $showCamera) {
                CameraPicker { image in
                    if captureFront { frontImage = image } else { backImage = image }
                    card = nil; inventoryResult = nil; comps = nil
                    errorMessage = ""; inventoryError = ""; compsError = ""
                }
            }
        }
    }

    private var scannerView: some View {
        VStack(spacing: 20) {
            captureView("FRONT", image: frontImage, front: true)
            captureView("BACK", image: backImage, front: false)
            Button { Task { await identifyCard() } } label: {
                Label(isScanning ? "Identifying..." : "Identify Card", systemImage: isScanning ? "hourglass" : "sparkles")
                    .font(.headline).frame(maxWidth: .infinity).padding()
            }.buttonStyle(.borderedProminent).padding(.horizontal)
             .disabled(frontImage == nil || backImage == nil || isScanning)
            if !errorMessage.isEmpty { errorText(errorMessage) }
        }
    }

    private func captureView(_ title: String, image: UIImage?, front: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.caption.bold()).foregroundStyle(.secondary)
            if let image {
                Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 300)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            } else {
                Image(systemName: "rectangle.viewfinder").font(.system(size: 55)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).frame(height: 160).background(.thinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            Button { captureFront = front; showCamera = true } label: {
                Label(image == nil ? "Scan \(title.capitalized)" : "Retake \(title.capitalized)", systemImage: "camera.fill")
                    .frame(maxWidth: .infinity)
            }.buttonStyle(.bordered)
        }.padding(.horizontal)
    }

    private func resultView(_ r: CardIdentification) -> some View {
        VStack(spacing: 18) {
            if let frontImage {
                Image(uiImage: frontImage).resizable().scaledToFit().frame(maxHeight: 330)
                    .clipShape(RoundedRectangle(cornerRadius: 18)).padding(.horizontal)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(r.player.isEmpty ? "Unknown Player" : r.player).font(.largeTitle.bold())
                Text([r.year, r.manufacturer, r.set].filter { !$0.isEmpty }.joined(separator: " • "))
                    .font(.title3).foregroundStyle(.secondary)
                if !r.cardNumber.isEmpty { Text("#\(r.cardNumber)").font(.headline) }
                Text("\(r.confidence) CONFIDENCE").font(.caption.bold()).padding(.horizontal, 10).padding(.vertical, 6)
                    .background(.thinMaterial).clipShape(Capsule())
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal)
            cardDetails(r); inventorySection(r); compsSection(r)
            Button {} label: { Label("Create Listing", systemImage: "tag.fill").frame(maxWidth: .infinity).padding() }
                .buttonStyle(.bordered).padding(.horizontal)
            Button { resetCard() } label: { Label("Scan Another Card", systemImage: "arrow.counterclockwise") }.padding()
        }
    }

    private func cardDetails(_ r: CardIdentification) -> some View {
        VStack(spacing: 12) {
            row("Sport", r.sport); row("Team", r.team); row("Manufacturer", r.manufacturer); row("Set", r.set)
            row("Parallel", r.parallel); row("Serial", r.serialNumber); row("Rookie", r.rookie ? "Yes" : "No")
            row("Autograph", r.autograph ? "Yes" : "No"); row("Relic", r.relic ? "Yes" : "No")
            if r.graded { row("Grade", [r.gradingCompany, r.grade].filter { !$0.isEmpty }.joined(separator: " ")) }
            if !r.notes.isEmpty { Divider(); VStack(alignment: .leading) { Text("Notes").font(.caption).foregroundStyle(.secondary); Text(r.notes) }.frame(maxWidth: .infinity, alignment: .leading) }
        }.padding().background(.thinMaterial).clipShape(RoundedRectangle(cornerRadius: 18)).padding(.horizontal)
    }

    @ViewBuilder private func inventorySection(_ r: CardIdentification) -> some View {
        VStack(spacing: 14) {
            Button { Task { await checkInventory(r) } } label: {
                Label(isCheckingInventory ? "Checking Inventory..." : "Check BTCo Inventory", systemImage: "shippingbox.fill")
                    .font(.headline).frame(maxWidth: .infinity).padding()
            }.buttonStyle(.borderedProminent).disabled(isCheckingInventory)
            if !inventoryError.isEmpty { errorText(inventoryError) }
            if let inventoryResult { inventoryView(inventoryResult) }
        }.padding(.horizontal)
    }

    private func inventoryView(_ x: InventoryLookupResponse) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(x.found ? "BTCo MATCH FOUND" : "NO EXACT MATCH", systemImage: x.found ? "checkmark.circle.fill" : "questionmark.circle.fill").font(.headline)
            if x.matches.isEmpty {
                Text("This card does not appear to be in the current BTCo inventory export.").foregroundStyle(.secondary)
            } else {
                Text(x.found ? "\(x.exactMatchCount) exact match\(x.exactMatchCount == 1 ? "" : "es")" : "\(x.candidateCount) possible inventory match\(x.candidateCount == 1 ? "" : "es")").foregroundStyle(.secondary)
                ForEach(Array(x.matches.prefix(5).enumerated()), id: \.offset) { _, m in
                    VStack(alignment: .leading, spacing: 8) {
                        Divider(); Text(m.title.isEmpty ? "\(m.year) \(m.player) \(m.set)" : m.title).font(.headline)
                        row("Match score", "\(m.matchScore)")
                        if m.quantity > 0 { row("Quantity", "\(m.quantity)") }
                        if m.askingPrice > 0 { row("Asking", money(m.askingPrice)) }
                        if m.purchasePrice > 0 { row("COGS", money(m.purchasePrice)) }
                        if !m.status.isEmpty { row("Status", m.status) }
                        if !m.ebayStatus.isEmpty { row("eBay", platform(m.ebayStatus, m.ebayQuantity)) }
                        if !m.collxStatus.isEmpty { row("CollX", platform(m.collxStatus, m.collxQuantity)) }
                        if !m.whatnotStatus.isEmpty { row("Whatnot", platform(m.whatnotStatus, m.whatnotQuantity)) }
                        let loc = [m.cabinet.isEmpty ? "" : "Cabinet \(m.cabinet)", m.shelf.isEmpty ? "" : "Shelf \(m.shelf)", m.box.isEmpty ? "" : "Box \(m.box)", m.row.isEmpty ? "" : "Row \(m.row)", m.section.isEmpty ? "" : "Section \(m.section)"].filter { !$0.isEmpty }.joined(separator: " • ")
                        if !loc.isEmpty { row("Location", loc) }
                        if !m.sku.isEmpty { row("SKU", m.sku) }
                        if !m.matchReasons.isEmpty { Text("Matched on: \(m.matchReasons.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }
        }.padding().background(.thinMaterial).clipShape(RoundedRectangle(cornerRadius: 18))
    }

    @ViewBuilder private func compsSection(_ r: CardIdentification) -> some View {
        VStack(spacing: 14) {
            Button { Task { await findComps(r) } } label: {
                Label(isFindingComps ? "Finding Market..." : "Find Comps", systemImage: "dollarsign.circle.fill")
                    .font(.headline).frame(maxWidth: .infinity).padding()
            }.buttonStyle(.bordered).disabled(isFindingComps)
            if !compsError.isEmpty { errorText(compsError) }
            if let comps { compsView(comps) }
        }.padding(.horizontal)
    }

    private func compsView(_ x: CompResponse) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Label("ACTIVE MARKET", systemImage: "chart.line.uptrend.xyaxis").font(.headline); Spacer(); Text(x.market.confidence).font(.caption.bold()).padding(6).background(.thinMaterial).clipShape(Capsule()) }
            Text("eBay Active Listings").font(.subheadline).foregroundStyle(.secondary)
            HStack(spacing: 10) { marketStat("LOW", x.market.low); marketStat("MEDIAN", x.market.median); marketStat("HIGH", x.market.high) }
            Divider()
            HStack {
                VStack(alignment: .leading) { Text("Suggested List").font(.caption).foregroundStyle(.secondary); Text(money(x.market.suggestedList)).font(.title2.bold()) }
                Spacer()
                VStack(alignment: .trailing) { Text("Quick Sale").font(.caption).foregroundStyle(.secondary); Text(money(x.market.quickSale)).font(.title2.bold()) }
            }
            Text("\(x.relevantCount) relevant listings • \(x.pricingCount) used for pricing").font(.caption).foregroundStyle(.secondary)
            if !x.warnings.isEmpty { Divider(); Label("Identification Warning", systemImage: "exclamationmark.triangle.fill").font(.subheadline.bold()); ForEach(x.warnings, id: \.self) { Text($0).font(.caption) } }
            if !x.listings.isEmpty {
                Divider(); Text("Comparable Listings").font(.headline)
                ForEach(Array(x.listings.prefix(5))) { l in
                    VStack(alignment: .leading, spacing: 8) {
                        Divider(); Text(l.title).font(.subheadline.bold())
                        HStack { Text(money(l.deliveredPrice)).font(.headline); Spacer(); Text("Match \(l.score)").font(.caption.bold()) }
                        Text(l.shipping > 0 ? "\(money(l.price)) + \(money(l.shipping)) shipping" : "\(money(l.price)) • Free/Included shipping").font(.caption).foregroundStyle(.secondary)
                        if !l.condition.isEmpty { Text(l.condition).font(.caption).foregroundStyle(.secondary) }
                        if !l.reasons.isEmpty { Text("Matched: \(l.reasons.joined(separator: ", "))").font(.caption2).foregroundStyle(.secondary) }
                        if let url = URL(string: l.itemWebUrl), !l.itemWebUrl.isEmpty { Link(destination: url) { Label("View on eBay", systemImage: "arrow.up.right.square").font(.caption.bold()) } }
                    }
                }
            }
            Text("Active asking prices — not completed sales.").font(.caption2).foregroundStyle(.secondary)
        }.padding().background(.thinMaterial).clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private func marketStat(_ title: String, _ value: Double) -> some View {
        VStack { Text(title).font(.caption2).foregroundStyle(.secondary); Text(money(value)).font(.headline).minimumScaleFactor(0.7) }
            .frame(maxWidth: .infinity).padding(.vertical, 10).background(.thinMaterial).clipShape(RoundedRectangle(cornerRadius: 12))
    }

    @MainActor private func identifyCard() async {
        guard let f = frontImage, let b = backImage,
              let fd = f.jpegData(compressionQuality: 0.75), let bd = b.jpegData(compressionQuality: 0.75),
              let url = URL(string: "\(server)/scan-card") else { errorMessage = "Could not prepare card images."; return }
        isScanning = true; errorMessage = ""; defer { isScanning = false }
        let boundary = UUID().uuidString
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 90
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data(); addImage(fd, name: "front", filename: "front.jpg", boundary: boundary, body: &body); addImage(bd, name: "back", filename: "back.jpg", boundary: boundary, body: &body); body.append(Data("--\(boundary)--\r\n".utf8)); request.httpBody = body
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { errorMessage = "Invalid server response."; return }
            guard (200...299).contains(http.statusCode) else { errorMessage = "Server \(http.statusCode): " + (String(data: data, encoding: .utf8) ?? "Unknown error"); return }
            card = try JSONDecoder().decode(ScanResponse.self, from: data).card; inventoryResult = nil; comps = nil
        } catch { errorMessage = "Scan failed: \(error.localizedDescription)" }
    }

    @MainActor private func checkInventory(_ r: CardIdentification) async {
        guard let url = URL(string: "\(server)/check-inventory") else { inventoryError = "Invalid inventory URL."; return }
        isCheckingInventory = true; inventoryError = ""; defer { isCheckingInventory = false }
        do {
            var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 30
            request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONEncoder().encode(r)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { inventoryError = "Inventory request failed: " + (String(data: data, encoding: .utf8) ?? "Unknown error"); return }
            inventoryResult = try JSONDecoder().decode(InventoryLookupResponse.self, from: data)
        } catch { inventoryError = "Inventory check failed: \(error.localizedDescription)" }
    }

    @MainActor private func findComps(_ r: CardIdentification) async {
        guard let url = URL(string: "\(server)/find-comps") else { compsError = "Invalid comps URL."; return }
        isFindingComps = true; compsError = ""; comps = nil; defer { isFindingComps = false }
        do {
            var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 45
            request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONEncoder().encode(r)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { compsError = "Market request failed: " + (String(data: data, encoding: .utf8) ?? "Unknown error"); return }
            comps = try JSONDecoder().decode(CompResponse.self, from: data)
        } catch { compsError = "Comp search failed: \(error.localizedDescription)" }
    }

    private func addImage(_ data: Data, name: String, filename: String, boundary: String, body: inout Data) {
        body.append(Data("--\(boundary)\r\n".utf8)); body.append(Data("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n".utf8)); body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8)); body.append(data); body.append(Data("\r\n".utf8))
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) { Text(label).foregroundStyle(.secondary); Spacer(); Text(value.isEmpty ? "—" : value).multilineTextAlignment(.trailing).fontWeight(.medium) }
    }
    private func errorText(_ text: String) -> some View { Text(text).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal) }
    private func money(_ value: Double) -> String { value.formatted(.currency(code: "USD")) }
    private func platform(_ status: String, _ quantity: Int) -> String { quantity > 0 ? "\(status) • Qty \(quantity)" : status }
    private func resetCard() { frontImage = nil; backImage = nil; card = nil; inventoryResult = nil; comps = nil; errorMessage = ""; inventoryError = ""; compsError = "" }
}

struct CameraPicker: UIViewControllerRepresentable {
    let onImagePicked: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss
    func makeUIViewController(context: Context) -> UIImagePickerController { let picker = UIImagePickerController(); picker.sourceType = .camera; picker.delegate = context.coordinator; return picker }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let parent: CameraPicker; init(_ parent: CameraPicker) { self.parent = parent }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) { if let image = info[.originalImage] as? UIImage { parent.onImagePicked(image) }; parent.dismiss() }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

#Preview { ContentView() }
