/**
 * Just enough of the OLE compound file format to lift one stream out of a
 * Word embedding.
 *
 * A MathType formula is stored as `word/embeddings/oleObjectN.bin`, which is a
 * whole little filesystem — the format Office used before .docx. All that is
 * wanted from it is the "Equation Native" stream, so this reads the sector
 * table, walks the directory, and stops. It is not a general implementation and
 * does not try to be.
 *
 * These bytes arrive from an uploaded document, so nothing here trusts them:
 * every sector index is bounds-checked and every chain walk carries a visited
 * set. A malformed file returns null. It never throws and it never spins.
 */

const SIGNATURE = "d0cf11e0a1b11ae1";
const HEADER_BYTES = 512;
const DIRECTORY_ENTRY_BYTES = 128;

/** Chain terminators. Anything else is the next sector. */
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;

const STREAM_OBJECT = 2;

/**
 * A DIFAT sector holds 109 entries in the header, then continues elsewhere. An
 * embedded equation is a few kilobytes — a handful of sectors — so the header's
 * own DIFAT always covers it and the continuation is not chased.
 */
const HEADER_DIFAT_ENTRIES = 109;

type Layout = {
  data: Buffer;
  sectorSize: number;
  miniSectorSize: number;
  miniCutoff: number;
  fat: number[];
  miniFat: number[];
  /** The whole mini stream, concatenated. */
  mini: Buffer;
};

function sectorOffset(sector: number, sectorSize: number): number {
  return HEADER_BYTES + sector * sectorSize;
}

/** Reads a sector, or null when it falls outside the file. */
function sector(data: Buffer, index: number, size: number): Buffer | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const start = sectorOffset(index, size);
  if (start < 0 || start + size > data.length) return null;
  return data.subarray(start, start + size);
}

/**
 * Follows a sector chain and concatenates it.
 *
 * The visited set is the whole point: a corrupt or hostile FAT can point a
 * sector at itself, and without it this loops until the process dies.
 */
function follow(
  data: Buffer,
  fat: number[],
  start: number,
  size: number,
  read: (index: number) => Buffer | null,
): Buffer | null {
  const parts: Buffer[] = [];
  const seen = new Set<number>();
  let current = start;

  while (current !== END_OF_CHAIN && current !== FREE_SECTOR) {
    if (seen.has(current)) return null;
    seen.add(current);

    const block = read(current);
    if (!block) return null;
    parts.push(block);

    const next = fat[current];
    if (next === undefined) return null;
    current = next;
  }

  return Buffer.concat(parts);
}

function readLayout(data: Buffer): Layout | null {
  if (data.length < HEADER_BYTES) return null;
  if (data.subarray(0, 8).toString("hex") !== SIGNATURE) return null;

  const sectorShift = data.readUInt16LE(0x1e);
  const miniSectorShift = data.readUInt16LE(0x20);
  // 512-byte and 4096-byte sectors are the only two the format defines.
  if (sectorShift !== 9 && sectorShift !== 12) return null;
  if (miniSectorShift !== 6) return null;

  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;
  const miniCutoff = data.readUInt32LE(0x38);

  // --- FAT, assembled from the sectors the header's DIFAT names.
  const fatSectorCount = data.readUInt32LE(0x2c);
  const fat: number[] = [];
  const perSector = sectorSize / 4;

  for (let i = 0; i < Math.min(fatSectorCount, HEADER_DIFAT_ENTRIES); i++) {
    const index = data.readUInt32LE(0x4c + i * 4);
    if (index === FREE_SECTOR || index === END_OF_CHAIN) break;
    const block = sector(data, index, sectorSize);
    if (!block) return null;
    for (let e = 0; e < perSector; e++) fat.push(block.readUInt32LE(e * 4));
  }
  if (fat.length === 0) return null;

  // --- directory
  const directoryStart = data.readUInt32LE(0x30);
  const directory = follow(data, fat, directoryStart, sectorSize, (i) =>
    sector(data, i, sectorSize),
  );
  if (!directory || directory.length < DIRECTORY_ENTRY_BYTES) return null;

  // --- mini FAT and the mini stream itself
  const miniFatStart = data.readUInt32LE(0x3c);
  const miniFat: number[] = [];
  if (miniFatStart !== END_OF_CHAIN && miniFatStart !== FREE_SECTOR) {
    const raw = follow(data, fat, miniFatStart, sectorSize, (i) =>
      sector(data, i, sectorSize),
    );
    if (!raw) return null;
    for (let e = 0; e + 4 <= raw.length; e += 4) miniFat.push(raw.readUInt32LE(e));
  }

  // Entry 0 is the root, and its chain is where every small stream lives.
  const rootStart = directory.readUInt32LE(0x74);
  const mini =
    rootStart === END_OF_CHAIN || rootStart === FREE_SECTOR
      ? Buffer.alloc(0)
      : (follow(data, fat, rootStart, sectorSize, (i) => sector(data, i, sectorSize)) ??
        Buffer.alloc(0));

  return { data, sectorSize, miniSectorSize, miniCutoff, fat, miniFat, mini };
}

/** The entry's name, which is UTF-16 with its length counted in bytes. */
function entryName(directory: Buffer, offset: number): string {
  const length = directory.readUInt16LE(offset + 0x40);
  // The recorded length includes the NUL terminator.
  if (length < 2 || length > 64) return "";
  return directory.subarray(offset, offset + length - 2).toString("utf16le");
}

/**
 * The named stream's bytes, or null when the file is not a compound file, does
 * not contain that stream, or is malformed in any way at all.
 */
export function readOleStream(data: Buffer, name: string): Buffer | null {
  const layout = readLayout(data);
  if (!layout) return null;

  const directory = follow(
    layout.data,
    layout.fat,
    layout.data.readUInt32LE(0x30),
    layout.sectorSize,
    (i) => sector(layout.data, i, layout.sectorSize),
  );
  if (!directory) return null;

  for (let offset = 0; offset + DIRECTORY_ENTRY_BYTES <= directory.length; offset += DIRECTORY_ENTRY_BYTES) {
    if (directory[offset + 0x42] !== STREAM_OBJECT) continue;
    if (entryName(directory, offset) !== name) continue;

    // A stream can be up to 2^64 bytes in the format; one that does not fit in
    // a JavaScript number is not an equation.
    const size = Number(directory.readBigUInt64LE(offset + 0x78));
    if (!Number.isSafeInteger(size) || size <= 0) return null;

    const start = directory.readUInt32LE(offset + 0x74);

    if (size < layout.miniCutoff) {
      const bytes = follow(layout.data, layout.miniFat, start, layout.miniSectorSize, (i) => {
        const from = i * layout.miniSectorSize;
        if (from < 0 || from + layout.miniSectorSize > layout.mini.length) return null;
        return layout.mini.subarray(from, from + layout.miniSectorSize);
      });
      if (!bytes || bytes.length < size) return null;
      return bytes.subarray(0, size);
    }

    const bytes = follow(layout.data, layout.fat, start, layout.sectorSize, (i) =>
      sector(layout.data, i, layout.sectorSize),
    );
    if (!bytes || bytes.length < size) return null;
    return bytes.subarray(0, size);
  }

  return null;
}
