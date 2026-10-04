/** What enumeration reports about one HID interface. Fields follow node-hid's device list. */
export interface HidDeviceInfo {
  vendorId: number;
  productId: number;
  path?: string | undefined;
  product?: string | undefined;
  manufacturer?: string | undefined;
  serialNumber?: string | undefined;
  usagePage?: number | undefined;
  usage?: number | undefined;
}

export interface TransportHandlers {
  /** One complete 64-byte input report, without any report ID prefix. */
  report(report: Uint8Array): void;
  /** The handle closed: unplugged, read error or closed by either side. Called at most once. */
  closed(error?: Error): void;
}

export interface TransportConnection {
  /** Writes one 64-byte output report; the transport adds any platform report ID prefix. */
  write(report: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/**
 * USB access seam. `list` is read-only enumeration and opens nothing. Only the connection manager calls `open`,
 * and only for a device that passed the controller matcher.
 */
export interface Transport {
  list(): Promise<HidDeviceInfo[]>;
  open(device: HidDeviceInfo, handlers: TransportHandlers): Promise<TransportConnection>;
}
