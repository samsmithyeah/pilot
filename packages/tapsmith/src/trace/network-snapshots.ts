import type { TapsmithGrpcClient } from '../grpc-client.js';

type Entry = Awaited<ReturnType<TapsmithGrpcClient['stopNetworkCapture']>>['entries'][number];

/** Per device and test attempt. Metadata is authoritative; omitted bodies retain bytes. */
export class NetworkSnapshots {
  entries: Entry[] = [];

  knownBodies(): Array<{ captureId: string; requestBodySize: number; responseBodySize: number }> {
    return this.entries.filter((e) => e.captureId).map((e) => ({
      captureId: e.captureId!, requestBodySize: e.requestBody?.length ?? 0,
      responseBodySize: e.responseBody?.length ?? 0,
    }));
  }

  update(entries: Entry[]): void {
    const previous = new Map(this.entries.filter((e) => e.captureId).map((e) => [e.captureId, e]));
    const retain = (next: Buffer, old: Buffer | undefined, omitted?: boolean): Buffer =>
      omitted ? (old ?? Buffer.alloc(0)) : old && next.equals(old) ? old : next;
    this.entries = entries.map((e) => {
      const old = e.captureId ? previous.get(e.captureId) : undefined;
      return { ...e,
        requestBody: retain(e.requestBody, old?.requestBody, e.requestBodyOmitted),
        responseBody: retain(e.responseBody, old?.responseBody, e.responseBodyOmitted),
      };
    });
  }
}
