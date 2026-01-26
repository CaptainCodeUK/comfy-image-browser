import { describe, expect, it } from "vitest";
import { parsePngMetadata } from "../src/lib/pngMetadata";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  return Buffer.concat([length, typeBuffer, data, crc]);
};

const createPngWithText = (keyword: string, text: string) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const textData = Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]);
  return Buffer.concat([
    pngSignature,
    chunk("IHDR", ihdr),
    chunk("tEXt", textData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

describe("parsePngMetadata", () => {
  it("extracts text chunks", () => {
    const buffer = createPngWithText("prompt", "{\"foo\":\"bar\"}");
    const metadata = parsePngMetadata(buffer);
    expect(metadata.textChunks.prompt).toBe("{\"foo\":\"bar\"}");
    expect(metadata.jsonChunks.prompt).toEqual({ foo: "bar" });
  });
});
