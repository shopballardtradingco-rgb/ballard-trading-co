import Foundation
import Security
import SwiftUI

enum VisionConnection {
    static let service = "com.BallardTradingCo.BTCoVision.server"
    static var baseURL: String { UserDefaults.standard.string(forKey: "BTCo.Vision.serverURL") ?? "http://192.168.4.50:3000" }
    static var token: String {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "service-token", kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
    static func authorize(_ request: inout URLRequest) {
        let value=token
        if !value.isEmpty { request.setValue("Bearer \(value)", forHTTPHeaderField: "Authorization") }
    }
    static func save(url: String, token: String) throws {
        let text=url.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let parsed=URL(string:text), let host=parsed.host, parsed.user == nil, parsed.password == nil, parsed.query == nil, parsed.fragment == nil,
              parsed.scheme == "https" || (parsed.scheme == "http" && (host == "localhost" || host.hasPrefix("192.168.") || host.hasPrefix("10.") || host == "127.0.0.1")) else { throw URLError(.badURL) }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "service-token"]
        if token.isEmpty {
            let status=SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw NSError(domain:NSOSStatusErrorDomain,code:Int(status)) }
        } else {
            let attributes: [String: Any] = [kSecValueData as String: Data(token.utf8), kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
            var status=SecItemUpdate(query as CFDictionary,attributes as CFDictionary)
            if status == errSecItemNotFound { status=SecItemAdd(query.merging(attributes){_,new in new} as CFDictionary,nil) }
            guard status == errSecSuccess else { throw NSError(domain:NSOSStatusErrorDomain,code:Int(status)) }
        }
        UserDefaults.standard.set(text,forKey:"BTCo.Vision.serverURL")
    }
}

struct VisionConnectionSettings: View {
    @State private var url=VisionConnection.baseURL
    @State private var token=VisionConnection.token
    @State private var message=""
    var body: some View {
        TextField("Vision server URL",text:$url).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
        SecureField("Vision service token",text:$token).textInputAutocapitalization(.never).autocorrectionDisabled()
        Button("Save connection") {
            do { try VisionConnection.save(url:url,token:token); message="Connection saved on this device." }
            catch { message="Could not save the connection. Use HTTPS or a local server address." }
        }
        if !message.isEmpty { Text(message).font(.caption) }
        Text("The server token stays in this device’s Keychain. Use the same protected recognition service as BTCo OS. Native inventory lookup still uses the service’s configured export until shared-account authentication is implemented.").font(.caption)
    }
}
