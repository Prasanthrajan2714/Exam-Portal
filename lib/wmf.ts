import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Turning Word's metafile equations into something a browser can show.
 *
 * Papers written with the old Equation Editor store each equation as a WMF or
 * EMF — a vector metafile. Word renders them; browsers cannot, so they arrived
 * in the review screen as broken-image icons with the chemistry inside them
 * unreadable.
 *
 * Windows itself can rasterise a metafile through GDI+, which is what this
 * shells out to. That makes it a Windows-only capability: everywhere else the
 * conversion returns null and the caller keeps the original bytes, so a paper is
 * never lost — its equations just stay unviewable until it is re-saved with the
 * equations as pictures.
 */

const METAFILE_TYPES = new Set(["image/x-wmf", "image/x-emf", "image/wmf", "image/emf"]);

export function isMetafile(contentType: string): boolean {
  return METAFILE_TYPES.has(contentType.trim().toLowerCase());
}

/** Widest we render. Equations sit inline, so this is generous already. */
const MAX_WIDTH = 1400;

export type RasterisedMetafile = {
  png: Buffer;
  /** The size Word lays the equation out at, in CSS pixels. */
  width: number;
  height: number;
};

function script(input: string, output: string, sizeFile: string): string {
  // Rendered at a multiple of the metafile's own size and then capped: these are
  // vectors, so rasterising at 1x gives visibly soft text at reading size.
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$mf = [System.Drawing.Imaging.Metafile]::new('${input}')
try {
  $w = [double]$mf.Width
  $h = [double]$mf.Height
  if ($w -le 0 -or $h -le 0) { throw 'empty metafile' }
  $scale = [Math]::Min(4.0, ${MAX_WIDTH} / $w)
  if ($scale -lt 1.0) { $scale = 1.0 }
  $bw = [int][Math]::Max(1, [Math]::Round($w * $scale))
  $bh = [int][Math]::Max(1, [Math]::Round($h * $scale))
  $bmp = [System.Drawing.Bitmap]::new($bw, $bh)
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.Clear([System.Drawing.Color]::White)
      $g.SmoothingMode = 'AntiAlias'
      $g.InterpolationMode = 'HighQualityBicubic'
      $g.DrawImage($mf, 0, 0, $bw, $bh)
    } finally { $g.Dispose() }
    $bmp.Save('${output}', [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $bmp.Dispose() }
  # The size Word lays this out at — what it should actually display at.
  $cssW = [int][Math]::Round($mf.PhysicalDimension.Width / 100.0 / 25.4 * 96.0)
  $cssH = [int][Math]::Round($mf.PhysicalDimension.Height / 100.0 / 25.4 * 96.0)
  [System.IO.File]::WriteAllText('${sizeFile}', "$cssW $cssH")
} finally { $mf.Dispose() }
`.trim();
}

function runPowerShell(source: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", source],
      { windowsHide: true },
    );
    // A hung GDI+ call must not hold a paper upload open.
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 20_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/**
 * Rasterises a WMF/EMF to PNG bytes, or null when that is not possible here.
 * Null is an expected outcome, not an error: the caller falls back to storing
 * the original.
 */
export async function metafileToPng(data: Buffer): Promise<RasterisedMetafile | null> {
  if (process.platform !== "win32") return null;

  const dir = path.join(os.tmpdir(), `wmf-${randomUUID()}`);
  const input = path.join(dir, "in.wmf");
  const output = path.join(dir, "out.png");
  const sizeFile = path.join(dir, "size.txt");

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(input, data);

    const ok = await runPowerShell(script(input, output, sizeFile));
    if (!ok) return null;

    const png = await fs.readFile(output);
    // A blank render is worse than the original: it looks like a working image
    // that happens to say nothing.
    if (png.length === 0) return null;

    // Without this an inline equation displays at the size it was rasterised
    // at, which is how they came to fill an option box.
    let width = 0;
    let height = 0;
    try {
      const [w, h] = (await fs.readFile(sizeFile, "utf8")).trim().split(/\s+/);
      width = Number(w) || 0;
      height = Number(h) || 0;
    } catch {
      /* size is optional; the caller falls back to the raster's own size */
    }

    return { png, width, height };
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
