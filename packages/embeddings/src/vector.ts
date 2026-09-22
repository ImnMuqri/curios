/**
 * A vector on its way to Postgres and back.
 *
 * `Bytes` rather than a float array column or an extension type: this is a
 * blob we never query on, only read whole, and Prisma maps `Bytes` to
 * `Uint8Array` on Prisma 6 (it was `Buffer` before 6.0 -- every signature
 * here says `Uint8Array` deliberately).
 *
 * Little-endian is written explicitly through a DataView rather than by
 * handing a `Float32Array` its own buffer, which would use whatever the host
 * CPU happens to do. These bytes outlive the process that wrote them, and a
 * vector read back byte-swapped does not fail -- it silently scores every
 * fact as unrelated, which reads as "retrieval just is not very good".
 */
export function encodeVector(values: Float32Array | readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i += 1) {
    // `?? 0` is unreachable -- i is always in range -- but
    // noUncheckedIndexedAccess types the read as possibly undefined.
    view.setFloat32(i * 4, values[i] ?? 0, true);
  }
  return bytes;
}

/**
 * `byteOffset` and `byteLength` are passed to the DataView deliberately.
 *
 * Node allocates small Buffers as views into one shared pool, so `bytes.buffer`
 * is usually far larger than the vector and does not begin at it. A decode
 * that reads `bytes.buffer` alone returns whatever else happens to be in that
 * pool -- a bug that produces plausible-looking numbers and no error at all.
 */
export function decodeVector(bytes: Uint8Array, dims: number): Float32Array {
  const expected = dims * 4;
  if (bytes.byteLength !== expected) {
    throw new Error(
      `Expected ${expected} bytes for ${dims} dimensions, got ${bytes.byteLength} bytes.`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float32Array(dims);
  for (let i = 0; i < dims; i += 1) values[i] = view.getFloat32(i * 4, true);
  return values;
}
