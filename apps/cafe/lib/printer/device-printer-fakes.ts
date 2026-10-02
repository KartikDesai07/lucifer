import type {
  BleCharacteristicLike,
  BleDeviceLike,
  BleServerLike,
  BluetoothLike,
  SerialLike,
  SerialPortInfoLike,
  SerialPortLike,
  SerialWriterLike,
} from "@/lib/printer/web-printer-types";

// Test-only fakes shared by the device-printer suites: a manual clock, a Web
// Serial port/chooser and a Web Bluetooth device. Nothing here sleeps.

export async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export function makeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: (): number => now,
    setTimer: (fn: () => void, ms: number): unknown => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimer: (handle: unknown): void => void timers.delete(handle as number),
    pending: (): number => timers.size,
    async advance(ms: number): Promise<void> {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

export class PortFake implements SerialPortLike {
  opened = false;
  opens = 0;
  closes = 0;
  forgets = 0;
  failOpen = 0;
  failWrites = 0;
  hangWrites = 0;
  writeAttempts = 0;
  readyCount = 0;
  aborts = 0;
  // Chromium: open() on a port that is already open rejects with InvalidStateError. Opt-in so older suites keep their lax port.
  strictOpen = false;
  // The writer holding the stream's lock (Chromium: a second getWriter throws and close() rejects while it is held).
  held: SerialWriterLike | null = null;
  private rejectHung: (() => void) | null = null;
  baud: number[] = [];
  delivered: number[] = [];
  gates: Promise<void>[] = [];
  listeners = new Set<() => void>();
  constructor(public info: SerialPortInfoLike = { bluetoothServiceClassId: 0x1101 }) {}
  getInfo(): SerialPortInfoLike {
    return this.info;
  }
  async open(options: { baudRate: number }): Promise<void> {
    this.opens += 1;
    this.baud.push(options.baudRate);
    if (this.strictOpen && this.opened) throw Object.assign(new Error("The port is already open."), { name: "InvalidStateError" });
    if (this.failOpen > 0) {
      this.failOpen -= 1;
      throw new Error("port busy");
    }
    this.opened = true;
  }
  async close(): Promise<void> {
    if (this.held !== null) throw new TypeError("Cannot cancel a locked stream");
    this.closes += 1;
    this.opened = false;
  }
  async forget(): Promise<void> {
    this.forgets += 1;
  }
  addEventListener(_type: "disconnect", fn: () => void): void {
    this.listeners.add(fn);
  }
  removeEventListener(_type: "disconnect", fn: () => void): void {
    this.listeners.delete(fn);
  }
  drop(): void {
    this.opened = false;
    [...this.listeners].forEach((fn) => fn());
  }
  get writable() {
    if (!this.opened) return null;
    const bumpReady = (): void => {
      this.readyCount += 1;
    };
    const write = async (chunk: Uint8Array): Promise<void> => {
      this.writeAttempts += 1;
      if (this.hangWrites > 0) {
        this.hangWrites -= 1;
        await new Promise<never>((_resolve, reject) => {
          this.rejectHung = () => reject(new Error("The write was aborted."));
        });
      }
      const gate = this.gates.shift();
      if (gate) await gate;
      if (this.failWrites > 0) {
        this.failWrites -= 1;
        throw new Error("link down");
      }
      this.delivered.push(chunk.length);
    };
    return {
      getWriter: (): SerialWriterLike => {
        if (this.held !== null) throw new TypeError("The stream is locked to a writer");
        const writer: SerialWriterLike = {
          get ready() {
            bumpReady();
            return Promise.resolve();
          },
          write,
          releaseLock: () => {
            if (this.held === writer) this.held = null;
          },
          // Chromium: abort() rejects the write in flight; the lock goes back with releaseLock.
          abort: async () => {
            this.aborts += 1;
            this.rejectHung?.();
            this.rejectHung = null;
          },
        };
        this.held = writer;
        return writer;
      },
    };
  }
}

export class SerialFake implements SerialLike {
  granted: PortFake[] = [];
  chooser: PortFake | Error | null = null;
  getPortsCalls = 0;
  requestCalls = 0;
  lastRequest: unknown;
  async getPorts(): Promise<SerialPortLike[]> {
    this.getPortsCalls += 1;
    return [...this.granted];
  }
  requestPort(options?: unknown): Promise<SerialPortLike> {
    this.requestCalls += 1;
    this.lastRequest = options;
    const choice = this.chooser;
    if (choice instanceof Error) return Promise.reject(choice);
    if (choice === null) return Promise.reject(Object.assign(new Error("none"), { name: "NotFoundError" }));
    if (!this.granted.includes(choice)) this.granted.push(choice);
    return Promise.resolve(choice);
  }
}

export const BLE_SERVICE = "000018f0-0000-1000-8000-00805f9b34fb";
export const BLE_CHAR = "00002af1-0000-1000-8000-00805f9b34fb";

export class BleFake {
  connected = false;
  connectCalls = 0;
  failConnect = 0;
  // Web Bluetooth's connect() can wait for good; gatt.disconnect() aborts it (the connect rejects).
  hangConnect = 0;
  disconnects = 0;
  private abortConnect: (() => void) | null = null;
  writes: number[] = [];
  listeners = new Set<() => void>();
  char: BleCharacteristicLike = {
    uuid: BLE_CHAR,
    properties: { write: true, writeWithoutResponse: false },
    writeValueWithResponse: async (v) => void this.writes.push(v.length),
  };
  server: BleServerLike;
  device: BleDeviceLike;
  constructor(public id = "ble-1", public name = "Kitchen") {
    const isConnected = (): boolean => this.connected;
    const connect = async (): Promise<BleServerLike> => {
      this.connectCalls += 1;
      if (this.failConnect > 0) {
        this.failConnect -= 1;
        throw new Error("out of range");
      }
      if (this.hangConnect > 0) {
        this.hangConnect -= 1;
        await new Promise<never>((_resolve, reject) => {
          this.abortConnect = () => reject(new Error("NetworkError: connection attempt cancelled"));
        });
      }
      this.connected = true;
      return this.server;
    };
    this.server = {
      get connected() {
        return isConnected();
      },
      connect,
      disconnect: () => {
        this.disconnects += 1;
        this.connected = false;
        this.abortConnect?.();
        this.abortConnect = null;
      },
      getPrimaryService: async () => ({ uuid: BLE_SERVICE, getCharacteristic: async () => this.char, getCharacteristics: async () => [this.char] }),
      getPrimaryServices: async () => [],
    };
    this.device = {
      id,
      name,
      gatt: this.server,
      addEventListener: (_t, fn) => void this.listeners.add(fn),
      removeEventListener: (_t, fn) => void this.listeners.delete(fn),
    };
  }
  drop(): void {
    this.connected = false;
    [...this.listeners].forEach((fn) => fn());
  }
}

export interface BluetoothFake extends BluetoothLike {
  requestCalls: number;
}
export function bluetoothOf(fake: BleFake, withGetDevices: boolean): BluetoothFake {
  const api: BluetoothFake = {
    requestCalls: 0,
    requestDevice: async () => {
      api.requestCalls += 1;
      return fake.device;
    },
  };
  if (withGetDevices) api.getDevices = async () => [fake.device];
  return api;
}
