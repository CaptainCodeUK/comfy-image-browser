import { inflateSync } from "node:zlib";

export type ParsedPngMetadata = {
  textChunks: Record<string, string>;
  jsonChunks: Record<string, unknown>;
};

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const readUInt32 = (buffer: Buffer, offset: number) => buffer.readUInt32BE(offset);

export const readPngDimensions = (buffer: Buffer) => {
  for (let offset = 8; offset < buffer.length; ) {
    const length = readUInt32(buffer, offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IHDR") {
      const width = readUInt32(buffer, offset + 8);
      const height = readUInt32(buffer, offset + 12);
      return { width, height };
    }
    offset += 12 + length;
  }
  return null;
};

const ensurePng = (buffer: Buffer) => {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (buffer[i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }
  return true;
};

const parseTextChunk = (data: Buffer) => {
  const nullIndex = data.indexOf(0);
  if (nullIndex === -1) return null;
  const keyword = data.toString("latin1", 0, nullIndex);
  const text = data.toString("latin1", nullIndex + 1);
  return { keyword, text };
};

const parseITXtChunk = (data: Buffer) => {
  const nullIndex = data.indexOf(0);
  if (nullIndex === -1) return null;
  const keyword = data.toString("latin1", 0, nullIndex);
  const compressionFlag = data[nullIndex + 1];
  const compressionMethod = data[nullIndex + 2];
  let cursor = nullIndex + 3;
  const langEnd = data.indexOf(0, cursor);
  if (langEnd === -1) return null;
  cursor = langEnd + 1;
  const translatedEnd = data.indexOf(0, cursor);
  if (translatedEnd === -1) return null;
  cursor = translatedEnd + 1;
  const textData = data.subarray(cursor);
  if (compressionFlag === 0) {
    return { keyword, text: textData.toString("utf8") };
  }
  if (compressionMethod === 0) {
    try {
      const inflated = inflateSync(textData);
      return { keyword, text: inflated.toString("utf8") };
    } catch {
      return { keyword, text: "" };
    }
  }
  return null;
};

const parseParametersChunk = (value: string) => {
  const lines = value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\u0000/g, ""))
    .map((line) => line.trim());
  const promptLines: string[] = [];
  const metadataLines: string[] = [];
  let metadataMode = false;

  const isMetadataTrigger = (line: string) =>
    line.startsWith("<lora") || line.startsWith("Steps:") || line.startsWith("Sampler:") || line.startsWith("Seed:");

  for (const line of lines) {
    if (!line) {
      if (promptLines.length > 0) {
        metadataMode = true;
      }
      continue;
    }
    if (!metadataMode && isMetadataTrigger(line)) {
      metadataMode = true;
    }
    if (metadataMode) {
      metadataLines.push(line);
    } else {
      promptLines.push(line);
    }
  }

  const prompt = promptLines.join(" ").trim();
  const metadata: Record<string, string> = {};

  for (const line of metadataLines) {
    if (line.includes("<lora")) {
      if (metadata.loras) {
        metadata.loras = `${metadata.loras}\n${line}`;
      } else {
        metadata.loras = line;
      }
      continue;
    }
    const fragments = line
      .split(",")
      .map((fragment) => fragment.trim())
      .filter((fragment) => fragment.length > 0);
    for (const fragment of fragments) {
      const colonIndex = fragment.indexOf(":");
      if (colonIndex === -1) {
        continue;
      }
      const key = fragment.slice(0, colonIndex).trim();
      const rawValue = fragment.slice(colonIndex + 1).trim();
      const value = rawValue.replace(/^"/, "").replace(/"$/, "");
      if (key) {
        metadata[key] = value;
      }
    }
  }

  return { prompt: prompt || null, metadata };
};

export const parsePngMetadata = (buffer: Buffer): ParsedPngMetadata => {
  const textChunks: Record<string, string> = {};
  const jsonChunks: Record<string, unknown> = {};

  if (!ensurePng(buffer)) {
    return { textChunks, jsonChunks };
  }

  for (let offset = 8; offset < buffer.length; ) {
    const length = readUInt32(buffer, offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "tEXt") {
      const parsed = parseTextChunk(data);
      if (parsed) {
        textChunks[parsed.keyword] = parsed.text;
      }
    }

    if (type === "iTXt") {
      const parsed = parseITXtChunk(data);
      if (parsed) {
        textChunks[parsed.keyword] = parsed.text;
      }
    }

    offset += 12 + length;
  }

  for (const [key, value] of Object.entries(textChunks)) {
    try {
      jsonChunks[key] = JSON.parse(value);
    } catch {
      // ignore non-JSON metadata
    }
  }

  const parametersText = textChunks.parameters;
  if (parametersText) {
    const parsed = parseParametersChunk(parametersText);
    if (parsed.prompt && !textChunks.prompt) {
      textChunks.prompt = parsed.prompt;
    }
    if (Object.keys(parsed.metadata).length > 0) {
      jsonChunks.parameters = parsed.metadata;
    }
  }

  return { textChunks, jsonChunks };
};
