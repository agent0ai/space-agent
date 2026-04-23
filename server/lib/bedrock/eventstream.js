// Minimal decoder for AWS application/vnd.amazon.eventstream binary framing.
// We only care about extracting each frame's payload and its :event-type header.

const HEADER_TYPE_TRUE = 0;
const HEADER_TYPE_FALSE = 1;
const HEADER_TYPE_BYTE = 2;
const HEADER_TYPE_SHORT = 3;
const HEADER_TYPE_INTEGER = 4;
const HEADER_TYPE_LONG = 5;
const HEADER_TYPE_BYTE_ARRAY = 6;
const HEADER_TYPE_STRING = 7;
const HEADER_TYPE_TIMESTAMP = 8;
const HEADER_TYPE_UUID = 9;

function parseHeaders(buffer) {
  const headers = {};
  let offset = 0;

  while (offset < buffer.length) {
    const nameLen = buffer.readUInt8(offset);
    offset += 1;
    const name = buffer.slice(offset, offset + nameLen).toString("utf8");
    offset += nameLen;
    const type = buffer.readUInt8(offset);
    offset += 1;

    switch (type) {
      case HEADER_TYPE_TRUE:
        headers[name] = true;
        break;
      case HEADER_TYPE_FALSE:
        headers[name] = false;
        break;
      case HEADER_TYPE_BYTE:
        headers[name] = buffer.readInt8(offset);
        offset += 1;
        break;
      case HEADER_TYPE_SHORT:
        headers[name] = buffer.readInt16BE(offset);
        offset += 2;
        break;
      case HEADER_TYPE_INTEGER:
        headers[name] = buffer.readInt32BE(offset);
        offset += 4;
        break;
      case HEADER_TYPE_LONG:
        headers[name] = Number(buffer.readBigInt64BE(offset));
        offset += 8;
        break;
      case HEADER_TYPE_BYTE_ARRAY: {
        const len = buffer.readUInt16BE(offset);
        offset += 2;
        headers[name] = buffer.slice(offset, offset + len);
        offset += len;
        break;
      }
      case HEADER_TYPE_STRING: {
        const len = buffer.readUInt16BE(offset);
        offset += 2;
        headers[name] = buffer.slice(offset, offset + len).toString("utf8");
        offset += len;
        break;
      }
      case HEADER_TYPE_TIMESTAMP:
        headers[name] = Number(buffer.readBigInt64BE(offset));
        offset += 8;
        break;
      case HEADER_TYPE_UUID:
        headers[name] = buffer.slice(offset, offset + 16).toString("hex");
        offset += 16;
        break;
      default:
        throw new Error(`Unsupported eventstream header type: ${type}`);
    }
  }

  return headers;
}

export class EventStreamDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    if (!chunk || !chunk.length) {
      return [];
    }

    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);

    const frames = [];

    while (this.buffer.length >= 12) {
      const totalLength = this.buffer.readUInt32BE(0);
      const headersLength = this.buffer.readUInt32BE(4);

      if (this.buffer.length < totalLength) {
        break;
      }

      const headersStart = 12;
      const headersEnd = headersStart + headersLength;
      const payloadEnd = totalLength - 4;
      const headers = parseHeaders(this.buffer.slice(headersStart, headersEnd));
      const payload = this.buffer.slice(headersEnd, payloadEnd);

      frames.push({ headers, payload });

      this.buffer = this.buffer.slice(totalLength);
    }

    return frames;
  }
}
