import SwiftUI
import Combine

struct SellingProfile: Codable, Identifiable {
    var id: String
    var enabled = true
    var configured = false
    var feePercent = 0.0
    var fixedFee = 0.0
    var promotionPercent = 0.0
    var feeOnShipping = true
    var promotionOnShipping = true
    var buyerShipping = 0.0
    var postage = 0.0
    var supplies = 0.0
    var otherCosts = 0.0
}
struct EconomicSettings: Codable {
    var collectorMode = false
    var budget = 100.0
    var itemLimit = 100.0
    var purchaseTaxPercent = 0.0
    var minimumProfit = 0.01
    var minimumMarginPercent = 0.0
    var minimumROIPercent = 0.0
    var maximumValuePremiumPercent = 0.0
    var requireSoldEvidence = true
    var channels = [
        SellingProfile(id: "eBay", configured: true, feePercent: 15, promotionPercent: 5, postage: 1.0, supplies: 0.25),
        SellingProfile(id: "CollX", enabled: false),
        SellingProfile(id: "Whatnot", enabled: false)
    ]
}
struct AcquisitionEntry: Codable, Identifiable {
    var id = UUID()
    var title: String
    var cost: Double
    var purchased = false
}
@MainActor
final class AcquisitionStore: ObservableObject {
    @Published var settings: EconomicSettings { didSet { save() } }
    @Published var entries: [AcquisitionEntry] { didSet { save() } }
    private let key = "BTCo.AcquisitionEconomics.v1"
    private struct Saved: Codable { var settings: EconomicSettings; var entries: [AcquisitionEntry] }
    init() {
        if let data = UserDefaults.standard.data(forKey: key), let saved = try? JSONDecoder().decode(Saved.self, from: data) {
            settings = saved.settings; entries = saved.entries
        } else { settings = EconomicSettings(); entries = [] }
    }
    private func save() {
        if let data = try? JSONEncoder().encode(Saved(settings: settings, entries: entries)) { UserDefaults.standard.set(data, forKey: key) }
    }
    var committed: Double { entries.reduce(0) { $0 + $1.cost } }
    var remaining: Double { max(0, settings.budget - committed) }
}

struct AcquisitionPanel: View {
    @ObservedObject var store: AcquisitionStore
    let card: CardIdentification
    let comps: CompResponse?
    @State private var price = ""
    @State private var incoming = "0"
    @State private var extra = "0"
    @State private var expected = ""
    @State private var confirmedEvidence = false
    @State private var conditionChecked = false
    @State private var reservation: UUID?
    private func number(_ value: String) -> Double? {
        guard let n = Double(value.replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "")), n.isFinite, n >= 0 else { return nil }
        return n
    }
    private var cost: Double? {
        guard let p = number(price), let shipping = number(incoming), let e = number(extra) else { return nil }
        return p * (1 + store.settings.purchaseTaxPercent / 100) + shipping + e
    }
    private var value: Double? { number(expected) }
    private var evidenceOK: Bool { confirmedEvidence || (comps?.soldData == true && (comps?.pricingCount ?? 0) > 0) }
    private var available: Double {
        store.remaining + (store.entries.first(where: { $0.id == reservation })?.cost ?? 0)
    }
    private func profit(_ channel: SellingProfile, cost: Double, value: Double) -> Double {
        let revenue = value + channel.buyerShipping
        let feeBase = value + (channel.feeOnShipping ? channel.buyerShipping : 0)
        let adBase = value + (channel.promotionOnShipping ? channel.buyerShipping : 0)
        return revenue - cost - feeBase * channel.feePercent / 100 - adBase * channel.promotionPercent / 100 - channel.fixedFee - channel.postage - channel.supplies - channel.otherCosts
    }
    private var decision: (String, Color) {
        guard let cost else { return ("YELLOW • Enter the asking price and acquisition costs", .yellow) }
        guard cost <= available, cost <= store.settings.itemLimit else { return ("RED • Over your remaining budget or item limit", .red) }
        guard let value, value > 0, conditionChecked else { return ("YELLOW • Confirm identity, condition and estimated value", .yellow) }
        if store.settings.requireSoldEvidence && !evidenceOK { return ("YELLOW • Sold market evidence needs confirmation", .yellow) }
        if store.settings.collectorMode {
            return cost <= value * (1 + store.settings.maximumValuePremiumPercent / 100)
                ? ("GREEN • Within budget and your fair-value limit", .green)
                : ("RED • Above your fair-value limit", .red)
        }
        let selected = store.settings.channels.filter { $0.enabled }
        guard !selected.isEmpty, selected.allSatisfy({ $0.configured }) else { return ("YELLOW • Configure each enabled selling channel", .yellow) }
        let qualifies = selected.contains { channel in
            let net = profit(channel, cost: cost, value: value)
            let revenue = value + channel.buyerShipping
            return net >= store.settings.minimumProfit && revenue > 0
                && net / revenue * 100 >= store.settings.minimumMarginPercent
                && (cost > 0 ? net / cost * 100 >= store.settings.minimumROIPercent : net >= 0)
        }
        return qualifies ? ("GREEN • At least one channel meets your targets", .green) : ("RED • No enabled channel meets your targets", .red)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Purchase evaluation").font(.title3.bold())
            Text("Budget remaining: \(store.remaining.formatted(.currency(code: "USD")))")
            input("Asking price", $price)
            input("Incoming shipping", $incoming)
            input("Other acquisition costs", $extra)
            input(store.settings.collectorMode ? "Fair market value" : "Expected item sale price", $expected)
            if let cost { Text("All-in purchase: \(cost.formatted(.currency(code: "USD")))") }
            Text(comps?.soldData == true ? "Backend reports sold evidence." : "Suggested value comes from asking prices; confirm sold evidence separately.").font(.caption)
            Toggle("I verified matching sold evidence", isOn: $confirmedEvidence)
            Toggle("I checked exact identity and condition", isOn: $conditionChecked)
            Text(decision.0).font(.headline).foregroundStyle(decision.1)
            if let cost, let value, !store.settings.collectorMode {
                ForEach(store.settings.channels.filter { $0.enabled }) { channel in
                    if channel.configured {
                        let net = profit(channel, cost: cost, value: value)
                        Text("\(channel.id): \(net.formatted(.currency(code: "USD"))) net • \((value + channel.buyerShipping > 0 ? net / (value + channel.buyerShipping) * 100 : 0).formatted(.number.precision(.fractionLength(1))))% margin")
                    } else { Text("\(channel.id): costs not configured").foregroundStyle(.yellow) }
                }
            }
            Button(reservation == nil ? "Add this copy to basket" : "Update basket cost") {
                guard let cost, cost <= available, cost <= store.settings.itemLimit else { return }
                if let id = reservation, let index = store.entries.firstIndex(where: { $0.id == id }) {
                    guard !store.entries[index].purchased else { return }
                    store.entries[index].cost = cost
                } else {
                    let entry = AcquisitionEntry(title: "\(card.year) \(card.player) #\(card.cardNumber)", cost: cost)
                    reservation = entry.id; store.entries.append(entry)
                }
            }.buttonStyle(.borderedProminent)
                .disabled(cost == nil || (cost ?? 0) > available || (cost ?? 0) > store.settings.itemLimit || store.entries.contains(where: { $0.id == reservation && $0.purchased }))
            Text("Scanning does not spend money. Basket items reserve funds; mark purchases in Settings. Estimates exclude costs you have not entered.").font(.caption)
        }.padding().background(.white.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 16))
            .foregroundStyle(.white)
            .onAppear { if expected.isEmpty, let comps, comps.market.quickSale > 0 { expected = String(format: "%.2f", comps.market.quickSale) } }
            .onChange(of: comps?.market.quickSale) { _, newValue in
                if expected.isEmpty, let newValue, newValue > 0 { expected = String(format: "%.2f", newValue) }
            }
    }
    private func input(_ title: String, _ binding: Binding<String>) -> some View {
        HStack { Text(title); Spacer(); TextField("Required", text: binding).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 110) }
    }
}

struct EconomicsSettingsView: View {
    @ObservedObject var store: AcquisitionStore
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section("Buying model") {
                    Toggle("Personal collection mode", isOn: $store.settings.collectorMode)
                    money("Session budget", $store.settings.budget)
                    money("Maximum per item", $store.settings.itemLimit)
                    money("Purchase tax %", $store.settings.purchaseTaxPercent)
                    Toggle("Require sold evidence for green", isOn: $store.settings.requireSoldEvidence)
                    money("Minimum net profit", $store.settings.minimumProfit)
                    money("Minimum margin %", $store.settings.minimumMarginPercent)
                    money("Minimum ROI %", $store.settings.minimumROIPercent)
                    money("Collector premium allowance %", $store.settings.maximumValuePremiumPercent)
                }
                Section("BTCo defaults") {
                    Text("eBay: 15% estimated selling reserve + known 5% promotion = 20% total reserve. Postage $1 and supplies $0.25 are editable estimates. $100 session/item limits are starting settings. No percentage-margin floor; positive net profit is required. Use actual postage for bubble mailers, slabs or comics.").font(.caption)
                    Text("CollX and Whatnot start disabled with unconfigured fees. Enable and enter your own costs; the app does not invent their fee schedules.").font(.caption)
                }
                ForEach($store.settings.channels) { $channel in
                    Section(channel.id) {
                        Toggle("Enabled", isOn: $channel.enabled)
                        Toggle("Costs configured", isOn: $channel.configured)
                        money("Selling fee %", $channel.feePercent)
                        money("Fixed order fee", $channel.fixedFee)
                        money("Promotion %", $channel.promotionPercent)
                        Toggle("Fee applies to buyer shipping", isOn: $channel.feeOnShipping)
                        Toggle("Promotion applies to buyer shipping", isOn: $channel.promotionOnShipping)
                        money("Shipping charged to buyer", $channel.buyerShipping)
                        money("Outbound postage", $channel.postage)
                        money("Packaging supplies", $channel.supplies)
                        money("Other sale costs / grading / overhead", $channel.otherCosts)
                    }
                }
                Section("Session basket and purchases") {
                    Text("Remaining: \(store.remaining.formatted(.currency(code: "USD")))")
                    ForEach(store.entries) { entry in
                        VStack(alignment: .leading) {
                            Text(entry.title)
                            Text("\(entry.cost.formatted(.currency(code: "USD"))) • \(entry.purchased ? "Purchased" : "Reserved")")
                            if !entry.purchased {
                                Button("Mark purchased") {
                                    if let i = store.entries.firstIndex(where: { $0.id == entry.id }) { store.entries[i].purchased = true }
                                }
                                Button("Remove reservation", role: .destructive) { store.entries.removeAll { $0.id == entry.id } }
                            }
                        }
                    }
                    Button("Start new budget session", role: .destructive) { store.entries = [] }
                    Text("Starting a new session clears this budget ledger. It does not alter inventory.").font(.caption)
                }
            }.navigationTitle("Economics settings")
                .toolbar { Button("Done") { dismiss() } }
        }
    }
    private func money(_ title: String, _ binding: Binding<Double>) -> some View {
        HStack {
            Text(title); Spacer()
            TextField("0", value: Binding(get: { binding.wrappedValue }, set: { binding.wrappedValue = $0.isFinite ? max(0, $0) : 0 }), format: .number)
                .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 100)
        }
    }
}
