import { PDFDocument } from 'pdf-lib';

type WorkerRequest = { id: string; file: File };
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};
const context = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

context.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, file } = event.data;
  try {
    if (file.type === 'image/png') {
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const drawing = canvas.getContext('2d');
        if (!drawing) throw new Error('Canvas is unavailable.');
        drawing.drawImage(bitmap, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        context.postMessage({ id, blob, method: 'png-lossless' });
        return;
      } finally {
        bitmap.close();
      }
    }

    if (file.type === 'application/pdf') {
      const source = await file.arrayBuffer();
      const raw = new TextDecoder('latin1').decode(new Uint8Array(source));
      if (/\/ByteRange\s*\[|\/Type\s*\/Sig\b|\/FT\s*\/Sig\b|\/AcroForm\b|\/XFA\b|\/EmbeddedFiles\b|\/Filespec\b|\/Outlines\b|\/StructTreeRoot\b|\/OutputIntents\b|\/AF\s*\[/i.test(raw)) {
        context.postMessage({ id, reason: 'protected-pdf' });
        return;
      }
      const pdf = await PDFDocument.load(source);
      const optimized = await pdf.save({ useObjectStreams: true });
      context.postMessage({
        id,
        blob: new Blob([toArrayBuffer(optimized)], { type: 'application/pdf' }),
        method: 'pdf-structure',
      });
      return;
    }

    context.postMessage({ id });
  } catch (error) {
    context.postMessage({ id, error: error instanceof Error ? error.message : 'Optimization failed.' });
  }
};
