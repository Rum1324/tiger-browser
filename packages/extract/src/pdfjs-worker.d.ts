// pdfjs-dist ships no types for its worker module; only its handler export is used, as an opaque value.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
