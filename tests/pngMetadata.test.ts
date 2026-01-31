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

  it("handles parameters-style metadata", () => {
    const parametersText = [
      "A beautiful 19 year old woman",
      "Hair falling over her shoulders in loose waves",
      "She is wearing a short, tight nurse outfit, fluxnurse with thighhighs, stockings. the outfit is open to the waist her breasts, tits and lots of cleavage are visible",
      "Facing the camera, looking at the camera, medium bokeh",
      "Glamour pose, professional lighting",
      "The photograph is taken with a professional DSLR camera, 4k, studio quality",
      "Standing by the bank of an urban river. The sun is setting behind her, golden hour",
      "<lora:Flux Nurse outfit 512X768:0.75> <lora:Adele_Stephens_r1:1>",
      "Steps: 20, Sampler: Euler, Schedule type: Simple, CFG scale: 1, Distilled CFG Scale: 3.5, Seed: 2961654875, Size: 720x1280, Model hash: cfd31fba80, Model: fluxNSFWUNLOCKED_v20FP8, Lora hashes: \"Flux Nurse outfit 512X768: 1ba60a4cff60, Adele_Stephens_r1: b75b64b701c4\", Version: f2.0.1v1.10.1-previous-669-gdfdcbab6, Module 1: clip_l, Module 2: ae, Module 3: t5xxl_fp8_e4m3fn>\u009bXK",
    ].join("\n");
    const buffer = createPngWithText("parameters", parametersText);
    const metadata = parsePngMetadata(buffer);
    expect(metadata.textChunks.parameters).toBe(parametersText);
    expect(metadata.textChunks.prompt).toContain("A beautiful 19 year old woman");
    expect(metadata.jsonChunks.parameters).toMatchObject({
      Steps: "20",
      Sampler: "Euler",
      "Module 2": "ae",
    });
    expect((metadata.jsonChunks.parameters as Record<string, string>).loras).toContain("<lora");
  });
});
