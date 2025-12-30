declare module 'y-protocols/sync' {
  import * as Y from 'yjs';
  import * as encoding from 'lib0/encoding';
  import * as decoding from 'lib0/decoding';

  export function writeSyncStep1(encoder: encoding.Encoder, doc: Y.Doc): void;
  export function writeSyncStep2(encoder: encoding.Encoder, doc: Y.Doc, encodedStateVector?: Uint8Array): void;
  export function readSyncStep1(decoder: decoding.Decoder, encoder: encoding.Encoder, doc: Y.Doc): void;
  export function readSyncStep2(decoder: decoding.Decoder, doc: Y.Doc, transactionOrigin?: any): void;
  export function readSyncMessage(
    decoder: decoding.Decoder,
    encoder: encoding.Encoder,
    doc: Y.Doc,
    transactionOrigin: any
  ): number;
  export function writeUpdate(encoder: encoding.Encoder, update: Uint8Array): void;
}

declare module 'y-protocols/awareness' {
  import * as Y from 'yjs';

  export class Awareness {
    doc: Y.Doc;
    clientID: number;
    states: Map<number, Record<string, any>>;
    constructor(doc: Y.Doc);
    getStates(): Map<number, Record<string, any>>;
    getLocalState(): Record<string, any> | null;
    setLocalState(state: Record<string, any> | null): void;
    setLocalStateField(field: string, value: any): void;
    on(event: string, callback: (...args: any[]) => void): void;
    off(event: string, callback: (...args: any[]) => void): void;
    destroy(): void;
  }

  export function encodeAwarenessUpdate(awareness: Awareness, clients: number[]): Uint8Array;
  export function applyAwarenessUpdate(awareness: Awareness, update: Uint8Array, origin: any): void;
  export function removeAwarenessStates(awareness: Awareness, clients: number[], origin: any): void;
}
