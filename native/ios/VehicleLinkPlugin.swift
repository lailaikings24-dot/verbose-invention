import Foundation
import Capacitor
import CoreBluetooth

/**
 * VehicleLink — the iOS side of TorqueMedic's native Bluetooth bridge.
 *
 * Safari exposes no Bluetooth API to web pages, which is exactly why the iOS
 * build needs this plugin: CoreBluetooth talking to a BLE ELM327 adapter
 * (Vgate iCar Pro BLE, Veepeak BLE+, OBDLink MX+, Vlinker MC+).
 *
 * Bluetooth Classic / SPP dongles are not reachable on iOS at all — they need
 * MFi certification — so only BLE is implemented here.
 *
 * Drop this file into ios/App/App/VehicleLinkPlugin.swift and add the three
 * Info.plist Bluetooth usage strings (see native/README.md).
 */
@objc(VehicleLinkPlugin)
public class VehicleLinkPlugin: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate, CBPeripheralDelegate {

    public let identifier = "VehicleLinkPlugin"
    public let jsName = "VehicleLink"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
    ]

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var channel: CBCharacteristic?
    private var scanCall: CAPPluginCall?
    private var connectCall: CAPPluginCall?
    private var discovered: [String: [String: Any]] = [:]
    private var scanTimer: DispatchWorkItem?
    private var connectTimer: DispatchWorkItem?

    private let knownServices: [CBUUID] = [
        CBUUID(string: "FFE0"),
        CBUUID(string: "FFF0"),
        CBUUID(string: "18F0"),
        CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"),
    ]

    private var bluetoothOn: Bool {
        central?.state == .poweredOn
    }

    override public func load( bolean )
        
    central = CBCentralManager(delegate: self, queue: nil)
    }

    // ---- availability ------------------------------------------------------ //

    @objc func available(_ call: CAPPluginCall) {
        let state = central?.state ?? .unknown
        var reason: String?
        switch state {
        case .poweredOn: reason = nil
        case .poweredOff: reason = "Bluetooth is switched off. Turn it on in Control Centre."
        case .unauthorized: reason = "Bluetooth permission was denied for TorqueMedic. Enable it in Settings › Privacy › Bluetooth."
        case .unsupported: reason = "This device does not support Bluetooth LE."
        default: reason = "Bluetooth is still starting up. Try again in a moment."
        }
        var result: [String: Any] = [
            "platform": "ios",
            "bluetooth": state == .poweredOn,
            "permitted": state != .unauthorized,
        ]
        if let reason = reason { result["reason"] = reason }
        call.resolve(result)
    }

    // ---- scanning ---------------------------------------------------------- //

    @objc func scan(_ call: CAPPluginCall) {
        guard let central = central else {
            call.reject("Bluetooth is not available.")
            return
        }
        guard central.state == .poweredOn else {
            call.reject("Bluetooth is switched off or not permitted.")
            return
        }

        discovered = [:]
        scanCall = call
        central.scanForPeripherals(withServices: knownServices, options: [
            CBCentralManagerScanOptionAllowDuplicatesKey: false,
        ])

        let timeout = (call.getInt("timeoutMs") ?? 10000) / 1000
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, let pending = self.scanCall else { return }
            self.central?.stopScan()
            self.scanCall = nil
            pending.resolve(["devices": Array(self.discovered.values)])
        }
        scanTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(timeout), execute: work)
    }

    public func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        let name = peripheral.name
            ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
            ?? ""
        guard !name.isEmpty else { return }
        discovered[peripheral.identifier.uuidString] = [
            "id": peripheral.identifier.uuidString,
            "name": name,
            "rssi": RSSI.intValue,
            "link": "ble",
        ]
    }

    // ---- connection -------------------------------------------------------- //

    @objc func connect(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("A device id is required.")
            return
        }
        guard let central = central, central.state == .poweredOn else {
            call.reject("Bluetooth is switched off or not permitted.")
            return
        }

        scanTimer?.cancel()
        central.stopScan()
        if let pending = scanCall {
            scanCall = nil
            pending.resolve(["devices": Array(discovered.values)])
        }

        let target = central.retrievePeripherals(withIdentifiers: [UUID(uuidString: id) ?? UUID()]).first
            ?? central.retrieveConnectedPeripherals(withServices: knownServices).first { $0.identifier.uuidString == id }

        guard let device = target else {
            call.reject("That adapter is no longer in range. Scan again.")
            return
        }

        connectCall = call
        peripheral = device
        device.delegate = self

        // CoreBluetooth can sit in "connecting" for ever if the dongle is asleep,
        // which left the app spinning with no explanation.
        connectTimer?.cancel()
        let deadline = DispatchWorkItem { [weak self] in
            guard let self = self, let pending = self.connectCall else { return }
            self.connectCall = nil
            self.central?.cancelPeripheralConnection(device)
            pending.reject("The adapter did not answer. Power-cycle the dongle and try again.")
        }
        connectTimer = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: deadline)

        central.connect(device, options: nil)
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices(knownServices)
    }

    public func centralManager(
        _ central: CBCentralManager,
        didFailToConnect peripheral: CBPeripheral,
        error: Error?
    ) {
        connectTimer?.cancel()
        if let call = connectCall {
            connectCall = nil
            call.reject(error?.localizedDescription ?? "The adapter refused the connection.")
        }
    }

    public func centralManager(
        _ central: CBCentralManager,
        didDisconnectPeripheral peripheral: CBPeripheral,
        error: Error?
    ) {
        channel = nil
        connectTimer?.cancel()
        if let call = connectCall {
            connectCall = nil
            call.reject("The adapter closed the connection.")
            return
        }
        notifyListeners("linkLost", data: ["reason": error?.localizedDescription ?? "Adapter disconnected"])
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil else {
            failConnect("Service discovery failed: \(error!.localizedDescription)")
            return
        }
        for service in peripheral.services ?? [] {
            peripheral.discoverCharacteristics(nil, for: service)
        }
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        guard let characteristics = service.characteristics else { return }
        // The writable/notifying characteristic of a BLE serial bridge.
        let notify = characteristics.first { $0.properties.contains(.notify) }
        let writable = characteristics.first { $0.properties.contains(.write) || $0.properties.contains(.writeWithoutResponse) }
        guard let target = notify ?? writable else { return }

        channel = target
        peripheral.setNotifyValue(true, for: target)

        if let call = connectCall {
            connectCall = nil
            connectTimer?.cancel()
            call.resolve([
                "name": peripheral.name ?? "Bluetooth adapter",
                "profile": service.uuid.uuidString,
            ])
        }
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard let data = characteristic.value else { return }
        let text = String(data: data, encoding: .isoLatin1) ?? ""
        notifyListeners("data", data: ["data": text])
    }

    private func failConnect(_ message: String) {
        if let call = connectCall {
            connectCall = nil
            call.reject(message)
        }
    }

    // ---- I/O --------------------------------------------------------------- //

    @objc func write(_ call: CAPPluginCall) {
        guard let text = call.getString("data") else {
            call.reject("Nothing to write.")
            return
        }
        guard let peripheral = peripheral, let channel = channel else {
            call.reject("No adapter connected.")
            return
        }
        guard let bytes = text.data(using: .isoLatin1) else {
            call.reject("Could not encode the command.")
            return
        }

        // Use the write type the characteristic actually advertises: sending
        // .withoutResponse to a write-only channel fails silently.
        let noResponse = channel.properties.contains(.writeWithoutResponse)
        let chunkSize = max(20, peripheral.maximumWriteValueLength(for: noResponse ? .withoutResponse : .withResponse))
        var offset = 0
        while offset < bytes.count {
            let end = min(offset + chunkSize, bytes.count)
            let slice = bytes.subdata(in: offset..<end)
            peripheral.writeValue(slice, for: channel, type: noResponse ? .withoutResponse : .withResponse)
            offset = end
            if offset < bytes.count && noResponse { Thread.sleep(forTimeInterval: 0.02) }
        }
        call.resolve()
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        if let device = peripheral {
            central?.cancelPeripheralConnection(device)
        }
        peripheral = nil
        channel = nil
        call.resolve()
    }
}
