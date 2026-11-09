import type { LinkKind, Transport } from '../transport';
import { vehicleLink, type NativeDevice } from './bridge';

/**
 * Transport backed by the native Bluetooth plugin. Used on Android and iOS
 * where the browser sandbox cannot open a serial link to the adapter.
 */
export class NativeTransport implements Transport {
  readonly kind: LinkKind = 'native';
  label: string;
  detail = '';

  readonly device: NativeDevice;
  private unsubs: (() => void)[] = [];
  private onLost: ((reason: string) => void) | null = null;

  constructor(device: NativeDevice) {
    this.device = device;
    this.label = device.name || 'Bluetooth adapter';
  }

  onLostConnection(cb: (reason: string) => void) {
    this.onLost = cb;
  }

  async connect(onData: (chunk: string) => void): Promise<void> {
    const link = vehicleLink();
    if (!link) throw new Error('Native Bluetooth is only available in the Android or iOS app build of TorqueMedic.');

    const info = await link.connect(this.device);
    this.label = info.name || this.device.name || 'Bluetooth adapter';
    this.detail = info.profile || (this.device.link === 'classic' ? 'Serial port (SPP)' : 'BLE');
    this.unsubs.push(link.onData(onData));
    this.unsubs.push(link.onLinkLost((reason) => this.onLost?.(reason)));
  }

  async write(text: string): Promise<void> {
    const link = vehicleLink();
    if (!link) throw new Error('Native Bluetooth is not available.');
    await link.write(text);
  }

  async disconnect(): Promise<void> {
    this.unsubs.forEach((unsubscribe) => unsubscribe());
    this.unsubs = [];
    await vehicleLink()?.disconnect();
  }
}
