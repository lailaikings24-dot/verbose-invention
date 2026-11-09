package com.torquemedic.app

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothSocket
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import androidx.core.content.ContextCompat
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

/**
 * VehicleLink — the Android side of TorqueMedic's native Bluetooth bridge.
 *
 * Unlike a browser, Android can reach both kinds of ELM327 dongle:
 *   • BLE (GATT/UART)  — Vgate iCar Pro BLE, Veepeak BLE+, OBDLink MX+
 *   • Classic (RFCOMM) — the ubiquitous cheap "MINI" clones
 *
 * Drop this file into
 *   android/app/src/main/java/com/torquemedic/app/VehicleLinkPlugin.kt
 * and register it in MainActivity (see native/README.md).
 */
@CapacitorPlugin(
    name = "VehicleLink",
    permissions = [
        Permission(
            alias = "bluetooth",
            strings = [
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN,
            ]
        )
    ]
)
class VehicleLinkPlugin : Plugin() {

    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val knownServices = listOf(
        UUID.fromString("0000ffe0-0000-1000-8000-00805f9b34fb"),
        UUID.fromString("0000fff0-0000-1000-8000-00805f9b34fb"),
        UUID.fromString("000018f0-0000-1000-8000-00805f9b34fb"),
        UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e"),
    )
    private val notificationConfig = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    private val main = Handler(Looper.getMainLooper())

    private var gatt: BluetoothGatt? = null
    private var channel: BluetoothGattCharacteristic? = null
    private var socket: BluetoothSocket? = null
    private var socketInput: InputStream? = null
    private var socketOutput: OutputStream? = null
    private var readerThread: Thread? = null
    private var scanning = false

    private val adapter: BluetoothAdapter?
        get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    // ---- availability ------------------------------------------------------ //

    private fun hasPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            // Before Android 12, discovery needs location permission.
            return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
        }
        return ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
            PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) ==
            PackageManager.PERMISSION_GRANTED
    }

    @PluginMethod
    fun available(call: PluginCall) {
        val bt = adapter
        val result = JSObject()
        result.put("platform", "android")
        result.put("bluetooth", bt != null && bt.isEnabled)
        result.put("permitted", hasPermission())
        if (bt == null) result.put("reason", "This device has no Bluetooth adapter.")
        else if (!bt.isEnabled) result.put("reason", "Bluetooth is switched off. Turn it on and try again.")
        else if (!hasPermission()) result.put("reason", "TorqueMedic needs the Nearby devices permission to scan for adapters.")
        call.resolve(result)
    }

    // ---- scanning ---------------------------------------------------------- //

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun scan(call: PluginCall) {
        val bt = adapter
        if (bt == null || !bt.isEnabled) {
            call.reject("Bluetooth is switched off.")
            return
        }
        if (!hasPermission()) {
            requestPermissionForAlias("bluetooth", call, "scanPermissionCallback")
            return
        }
        beginScan(call)
    }

    @PluginMethod
    fun scanPermissionCallback(call: PluginCall) {
        if (!hasPermission()) {
            call.reject("Bluetooth permission was denied.")
            return
        }
        beginScan(call)
    }

    @SuppressLint("MissingPermission")
    private fun beginScan(call: PluginCall) {
        val found = LinkedHashMap<String, JSObject>()
        val bt = adapter ?: run {
            call.reject("Bluetooth is not available.")
            return
        }

        fun add(id: String, name: String, rssi: Int, link: String) {
            if (found.containsKey(id)) return
            val device = JSObject()
            device.put("id", id)
            device.put("name", name)
            device.put("rssi", rssi)
            device.put("link", link)
            found[id] = device
        }

        // Already-paired Classic dongles never show up in a BLE scan.
        runCatching {
            bt.bondedDevices?.forEach { device ->
                val name = device.name ?: "Paired adapter"
                if (device.type != BluetoothDevice.DEVICE_TYPE_LE && name.isNotBlank()) {
                    add(device.address, name, 0, "classic")
                }
            }
        }

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val name = result.device.name ?: result.scanRecord?.deviceName ?: ""
                if (name.isBlank()) return
                add(result.device.address, name, result.rssi, "ble")
            }

            override fun onScanFailed(errorCode: Int) {
                if (!scanning) return
                scanning = false
                call.reject("Bluetooth scan failed (code $errorCode).")
            }
        }

        val scanner = bt.bluetoothLeScanner
        if (scanner == null) {
            call.reject("This device cannot scan for Bluetooth LE adapters.")
            return
        }

        scanning = true
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        scanner.startScan(null, settings, callback)

        val timeout = call.getInt("timeoutMs") ?: 10_000
        main.postDelayed({
            if (!scanning) return@postDelayed
            scanning = false
            runCatching { scanner.stopScan(callback) }
            val result = JSObject()
            result.put("devices", JSArray(found.values.toList()))
            call.resolve(result)
        }, timeout.toLong())
    }

    // ---- BLE --------------------------------------------------------------- //

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun connect(call: PluginCall) {
        val id = call.getString("id") ?: run {
            call.reject("A device id is required.")
            return
        }
        val link = call.getString("link") ?: "ble"
        val device = runCatching { adapter?.getRemoteDevice(id) }.getOrNull()
        if (device == null) {
            call.reject("Adapter $id is not reachable.")
            return
        }
        if (link == "classic") connectClassic(call, device) else connectBle(call, device)
    }

    @SuppressLint("MissingPermission")
    private fun connectBle(call: PluginCall, device: BluetoothDevice) {
        var settled = false

        val callback = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    gatt = g
                    g.discoverServices()
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    gatt = null
                    channel = null
                    if (!settled) {
                        settled = true
                        call.reject("The adapter closed the connection.")
                    } else {
                        notifyListeners("linkLost", JSObject().put("reason", "Adapter disconnected"))
                    }
                }
            }

            override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
                val service = g.services.firstOrNull { knownServices.contains(it.uuid) }
                    ?: g.services.firstOrNull { s -> s.characteristics.any { it.uuid.uuid != 0x2a00 } }
                // Pick the characteristic that can both notify and write — that is
                // the serial channel. Grabbing a read-only status characteristic is
                // what makes a clone look "connected but mute".
                val hasReadWrite =
                    (it: BluetoothGattCharacteristic) -> (it.properties and
                        (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE)) != 0 &&
                        (it.properties and
                            (BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0
                val characteristic = service?.characteristics?.firstOrNull(hasReadWrite)
                    ?: service?.characteristics?.firstOrNull { it.uuid.uuid != 0x2a00 }
                // A larger MTU means fewer 20-byte round trips per ELM command.
                runCatching { g.requestMtu(185) }
                if (characteristic == null) {
                    settled = true
                    call.reject("Connected, but no serial channel was found. This may be a Classic-only dongle.")
                    g.disconnect()
                    return
                }
                g.setCharacteristicNotification(characteristic, true)
                characteristic.getDescriptor(notificationConfig)?.let { descriptor ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        g.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    } else {
                        @Suppress("DEPRECATION")
                        descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        @Suppress("DEPRECATION")
                        g.writeDescriptor(descriptor)
                    }
                }
                channel = characteristic
                if (!settled) {
                    settled = true
                    val result = JSObject()
                    result.put("name", device.name ?: "Bluetooth adapter")
                    result.put("profile", service.uuid.toString().substring(4, 8).uppercase())
                    call.resolve(result)
                }
            }

            override fun onCharacteristicChanged(
                g: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                value: ByteArray,
            ) {
                notifyListeners("data", JSObject().put("data", String(value, Charsets.ISO_8859_1)))
            }

            @Deprecated("Required below API 33")
            override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
                @Suppress("DEPRECATION")
                val value = characteristic.value ?: return
                notifyListeners("data", JSObject().put("data", String(value, Charsets.ISO_8859_1)))
            }
        }

        device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
    }

    // ---- Bluetooth Classic (RFCOMM/SPP) ------------------------------------ //

    @SuppressLint("MissingPermission")
    private fun connectClassic(call: PluginCall, device: BluetoothDevice) {
        adapter?.cancelDiscovery()
        Thread {
            try {
                val s = device.createRfcommSocketToServiceRecord(sppUuid)
                s.connect()
                socket = s
                socketInput = s.inputStream
                socketOutput = s.outputStream

                val result = JSObject()
                result.put("name", device.name ?: "Bluetooth adapter")
                result.put("profile", "Serial port (SPP)")
                main.post { call.resolve(result) }

                val buffer = ByteArray(1024)
                readerThread = Thread {
                    try {
                        val input = socketInput ?: return@Thread
                        while (true) {
                            val read = input.read(buffer)
                            if (read <= 0) break
                            val text = String(buffer, 0, read, Charsets.ISO_8859_1)
                            main.post { notifyListeners("data", JSObject().put("data", text)) }
                        }
                    } catch (_: Exception) {
                        // Socket closed.
                    } finally {
                        main.post { notifyListeners("linkLost", JSObject().put("reason", "Serial link closed")) }
                    }
                }.also { it.start() }
            } catch (error: Exception) {
                main.post { call.reject("Could not open the serial link: ${error.message}") }
            }
        }.start()
    }

    // ---- I/O --------------------------------------------------------------- //

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun write(call: PluginCall) {
        val text = call.getString("data") ?: run {
            call.reject("Nothing to write.")
            return
        }
        val bytes = text.toByteArray(Charsets.ISO_8859_1)

        val output = socketOutput
        if (output != null) {
            try {
                output.write(bytes)
                output.flush()
                call.resolve()
            } catch (error: Exception) {
                call.reject("Serial write failed: ${error.message}")
            }
            return
        }

        val g = gatt
        val characteristic = channel
        if (g == null || characteristic == null) {
            call.reject("No adapter connected.")
            return
        }
        // BLE serial bridges cap a packet at 20 bytes unless the MTU was raised.
        try {
            val noResponse = (characteristic.properties and
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
            val writeType = if (noResponse) BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                else BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            var offset = 0
            while (offset < bytes.size) {
                val end = minOf(offset + 20, bytes.size)
                val slice = bytes.copyOfRange(offset, end)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    g.writeCharacteristic(characteristic, slice, writeType)
                } else {
                    @Suppress("DEPRECATION")
                    characteristic.writeType = writeType
                    @Suppress("DEPRECATION")
                    characteristic.value = slice
                    @Suppress("DEPRECATION")
                    g.writeCharacteristic(characteristic)
                }
                offset = end
                // Without a gap the stack answers GATT_BUSY and drops the chunk.
                if (offset < bytes.size) Thread.sleep(20)
            }
            call.resolve()
        } catch (error: Exception) {
            call.reject("Bluetooth write failed: ${error.message}")
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun disconnect(call: PluginCall) {
        runCatching { socket?.close() }
        socket = null
        socketInput = null
        socketOutput = null
        runCatching { gatt?.disconnect() }
        runCatching { gatt?.close() }
        gatt = null
        channel = null
        readerThread?.interrupt()
        readerThread = null
        call.resolve()
    }

    override fun handleOnDestroy() {
        runCatching { socket?.close() }
        runCatching { gatt?.close() }
        super.handleOnDestroy()
    }
}
