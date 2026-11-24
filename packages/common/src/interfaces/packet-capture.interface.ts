import type { Readable } from 'node:stream';

/**
 * A network interface's frames asked of SyncBridge: it captures them
 * (tcpdump) for a worker declaring `network:capture`, once an admin
 * approved this interface and this filter for it
 */
export interface PacketCaptureRequest {
  /** The interface's name, as the server has it (`enp4s0f1`) */
  interface: string;
  /** A BPF filter, as tcpdump takes it (`udp port 24000`); none: all */
  filter?: string;
  /** Frames not addressed to the server too: default true */
  promiscuous?: boolean;
  /** Bytes of a frame kept: default PACKET_CAPTURE_SNAP_LENGTH */
  snapLength?: number;
}

/**
 * Opens a capture: a stream of pcap bytes - its global header first, then
 * a record each frame - read as tcpdump writes them. Closing it stops the
 * capture. Refused with an SbError of a PacketCaptureError code
 */
export type PacketCapture = (
  request: PacketCaptureRequest,
) => Promise<Readable>;

/** A frame's bytes kept, unless asked otherwise */
export const PACKET_CAPTURE_SNAP_LENGTH = 65535;

/** Why a capture was refused: its SbError's code */
export enum PacketCaptureError {
  /** The worker does not declare `network:capture` */
  NotPermitted = 'CAPTURE_NOT_PERMITTED',
  /** No admin approved this interface and filter for the worker yet */
  NotApproved = 'CAPTURE_NOT_APPROVED',
  /** The server has no interface of that name */
  NoSuchInterface = 'CAPTURE_NO_SUCH_INTERFACE',
  /** The filter does not compile */
  BadFilter = 'CAPTURE_BAD_FILTER',
  /** This worker captures this interface already, or the server enough */
  Limit = 'CAPTURE_LIMIT',
  /**
   * Not on this server: no tcpdump, no capability to capture (a container
   * without NET_RAW), or SyncBridge too old to capture
   */
  NotAvailable = 'CAPTURE_NOT_AVAILABLE',
}
