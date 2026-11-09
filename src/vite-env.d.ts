/// <reference types="vite/client" />

interface BluetoothCharacteristicLike {
  uuid: string;
  value?: DataView;
  properties?: {
    notify?: boolean;
    indicate?: boolean;
    read?: boolean;
    write?: boolean;
    writeWithoutResponse?: boolean;
  };
  startNotifications(): Promise<unknown>;
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  addEventListener(type: 'characteristicvaluechanged', listener: (ev: Event) => void): void;
}

interface GattServerLike {
  connected: boolean;
  connect(): Promise<GattServerLike>;
  disconnect(): void;
  getPrimaryServices(): Promise<GattServiceLike[]>;
}

interface GattServiceLike {
  uuid: string;
  getCharacteristics(): Promise<BluetoothCharacteristicLike[]>;
}

interface BluetoothDeviceLike {
  id: string;
  name?: string;
  gatt?: GattServerLike;
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void;
}

interface Navigator {
  bluetooth?: {
    requestDevice(options: {
      filters?: { namePrefix?: string; services?: (string | number)[] }[];
      acceptAllDevices?: boolean;
      optionalServices?: (string | number)[];
    }): Promise<BluetoothDeviceLike>;
    getAvailability?(): Promise<boolean>;
    /** Devices this origin already has permission for — no picker needed. */
    getDevices?(): Promise<BluetoothDeviceLike[]>;
  };
}
