import fs from "node:fs/promises";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { inlineEquations } from "@/lib/omml";

/**
 * Putting the decoded equation back into the document.
 *
 * Word wraps a MathType object in a run of its own, and that run usually
 * carries `<w:vertAlign w:val="subscript"/>` — nothing to do with the formula,
 * everything to do with how the picture sat on the line. Replacing only the
 * `<w:object>` leaves that run property behind, and `cleanText` then sets the
 * whole formula as a subscript of the words in front of it. So the run goes too.
 */

const EQUATION = "tests/fixtures/mathtype/circle-equation.bin";
const LEGACY = "tests/fixtures/mathtype/equation3-legacy.bin";

/** The smallest .docx that can carry an embedded equation. */
async function document(
  runs: string,
  embeddings: Record<string, Buffer>,
  relationships: string,
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document><w:body><w:p>${runs}</w:p></w:body></w:document>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships>${relationships}</Relationships>`,
  );
  for (const [name, data] of Object.entries(embeddings)) {
    zip.file(`word/embeddings/${name}`, data);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A run holding an equation object, as Word writes one. */
function equationRun(id: string, progId = "Equation.DSMT4"): string {
  return (
    `<w:r w:rsidR="00AB12"><w:rPr><w:vertAlign w:val="subscript"/></w:rPr>` +
    `<w:object w:dxaOrig="1520" w:dyaOrig="320">` +
    `<v:shape id="_x0000_i1025"><v:imagedata r:id="rIdPic"/></v:shape>` +
    `<o:OLEObject Type="Embed" ProgID="${progId}" ShapeID="_x0000_i1025" r:id="${id}"/>` +
    `</w:object></w:r>`
  );
}

const relationship = (id: string, target: string) =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="${target}"/>`;

async function bodyOf(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml")!.async("string");
}

describe("inlineEquations on a MathType document", () => {
  it("replaces the whole run with the equation as text", async () => {
    const docx = await document(
      `<w:r><w:t>The circle </w:t></w:r>${equationRun("rId7")}<w:r><w:t> is drawn.</w:t></w:r>`,
      { "oleObject1.bin": await fs.readFile(EQUATION) },
      relationship("rId7", "embeddings/oleObject1.bin"),
    );

    const result = await inlineEquations(docx);
    expect(result.converted).toBe(1);
    expect(result.pictures).toBe(0);

    const body = await bodyOf(result.buffer);
    expect(body).toContain("x²+y²+6x+6y+3=0");
    // The object and the picture that stood in for it are both gone.
    expect(body).not.toContain("OLEObject");
    expect(body).not.toContain("v:imagedata");
    // And so is the run property that would have subscripted the lot.
    expect(body).not.toContain("vertAlign");
  });

  it("pads the text so it does not weld itself to the words beside it", async () => {
    // Word lays an equation out as an object, so the text around one often has
    // no space of its own: "…the circles" + "x²+y²=4" + "also passes".
    const docx = await document(
      `<w:r><w:t>circles</w:t></w:r>${equationRun("rId7")}<w:r><w:t>also passes</w:t></w:r>`,
      { "oleObject1.bin": await fs.readFile(EQUATION) },
      relationship("rId7", "embeddings/oleObject1.bin"),
    );

    const body = await bodyOf((await inlineEquations(docx)).buffer);
    expect(body).toContain("> x²+y²+6x+6y+3=0 <");
  });

  it("leaves an object it cannot read exactly as it was", async () => {
    // The picture is the fallback, so the run has to survive byte for byte.
    const before = equationRun("rId7");
    const docx = await document(
      before,
      { "oleObject1.bin": await fs.readFile(LEGACY) },
      relationship("rId7", "embeddings/oleObject1.bin"),
    );

    const result = await inlineEquations(docx);
    expect(result.converted).toBe(0);
    expect(result.pictures).toBe(1);
    expect(await bodyOf(result.buffer)).toContain(before);
  });

  it("leaves an embedded object that is not an equation alone", async () => {
    // A spreadsheet or a chart is somebody else's business.
    const before = equationRun("rId7", "Excel.Sheet.12");
    const docx = await document(
      before,
      { "oleObject1.bin": await fs.readFile(EQUATION) },
      relationship("rId7", "embeddings/oleObject1.bin"),
    );

    const result = await inlineEquations(docx);
    expect(result.converted).toBe(0);
    expect(result.pictures).toBe(0);
    expect(await bodyOf(result.buffer)).toContain(before);
  });

  it("keeps a run with no object in it byte for byte", async () => {
    // Every other run in the document goes through the same replacement, so
    // rebuilding one has to be exact — attributes included.
    const plain = `<w:r w:rsidR="00CD34"><w:rPr><w:b/></w:rPr><w:t>Question 1.</w:t></w:r>`;
    const docx = await document(
      `${plain}${equationRun("rId7")}`,
      { "oleObject1.bin": await fs.readFile(EQUATION) },
      relationship("rId7", "embeddings/oleObject1.bin"),
    );

    expect(await bodyOf((await inlineEquations(docx)).buffer)).toContain(plain);
  });

  it("counts a picture when the relationship points nowhere", async () => {
    const docx = await document(
      equationRun("rId7"),
      {},
      relationship("rId7", "embeddings/missing.bin"),
    );

    const result = await inlineEquations(docx);
    expect(result.pictures).toBe(1);
    expect(await bodyOf(result.buffer)).toContain("OLEObject");
  });

  it("decodes an object referenced twice without reading it twice", async () => {
    const docx = await document(
      `${equationRun("rId7")}${equationRun("rId7")}`,
      { "oleObject1.bin": await fs.readFile(EQUATION) },
      relationship("rId7", "embeddings/oleObject1.bin"),
    );

    const result = await inlineEquations(docx);
    expect(result.converted).toBe(2);
    const body = await bodyOf(result.buffer);
    expect(body.match(/x²\+y²\+6x\+6y\+3=0/g)).toHaveLength(2);
  });

  it("leaves a document with neither equations nor objects untouched", async () => {
    const docx = await document(`<w:r><w:t>Plain question.</w:t></w:r>`, {}, "");
    const result = await inlineEquations(docx);
    expect(result).toMatchObject({ converted: 0, empty: 0, pictures: 0 });
    expect(result.buffer).toBe(docx);
  });
});
