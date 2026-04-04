/**
 * Minimal QR Code generator for ZeroBin
 * Generates QR codes on a canvas element
 * Based on the QR Code specification (ISO 18004)
 */

const QRCode = (() => {
  'use strict';

  // Galois Field GF(2^8) with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);

  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
    }
    for (let i = 255; i < 512; i++) {
      GF_EXP[i] = GF_EXP[i - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function polyMul(a, b) {
    const result = new Uint8Array(a.length + b.length - 1);
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        result[i + j] ^= gfMul(a[i], b[j]);
      }
    }
    return result;
  }

  function polyDiv(dividend, divisor) {
    const result = new Uint8Array(dividend);
    for (let i = 0; i < dividend.length - divisor.length + 1; i++) {
      if (result[i] !== 0) {
        const coef = result[i];
        for (let j = 0; j < divisor.length; j++) {
          result[i + j] ^= gfMul(divisor[j], coef);
        }
      }
    }
    return result.slice(dividend.length - divisor.length + 1);
  }

  function generatorPoly(n) {
    let g = new Uint8Array([1]);
    for (let i = 0; i < n; i++) {
      g = polyMul(g, new Uint8Array([1, GF_EXP[i]]));
    }
    return g;
  }

  // Error correction codewords count for each version (1-40) and level (L,M,Q,H)
  const EC_TABLE = [
    , // version 0 doesn't exist
    [7, 10, 13, 17], [10, 16, 22, 28], [15, 26, 36, 44], [20, 36, 52, 64],
    [26, 48, 72, 88], [36, 64, 96, 112], [40, 72, 108, 130], [48, 88, 132, 156],
    [60, 110, 160, 192], [72, 130, 192, 224], [80, 150, 224, 264], [96, 176, 260, 308],
    [104, 198, 288, 352], [120, 216, 320, 384], [132, 240, 360, 432], [144, 280, 408, 480],
    [168, 308, 448, 532], [180, 338, 504, 588], [196, 364, 546, 650], [224, 416, 600, 700],
    [224, 442, 644, 750], [252, 476, 690, 816], [270, 504, 750, 900], [300, 560, 810, 960],
    [312, 588, 870, 1050], [336, 644, 952, 1110], [360, 700, 1020, 1200], [390, 728, 1050, 1260],
    [420, 784, 1140, 1350], [450, 812, 1200, 1440], [480, 868, 1290, 1530], [510, 924, 1350, 1620],
    [540, 980, 1440, 1710], [570, 1036, 1530, 1800], [570, 1064, 1590, 1890],
    [600, 1120, 1680, 1980], [630, 1204, 1770, 2100], [660, 1260, 1860, 2220],
    [720, 1316, 1950, 2310], [750, 1372, 2040, 2430],
  ];

  // Data capacity (total codewords) per version
  const DATA_CAPACITY = [
    , 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655,
    733, 815, 901, 991, 1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921,
    2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
  ];

  const EC_LEVEL = { L: 0, M: 1, Q: 2, H: 3 };

  function getVersion(dataLength, ecLevel) {
    const ecIdx = EC_LEVEL[ecLevel] || 0;
    for (let v = 1; v <= 40; v++) {
      const capacity = DATA_CAPACITY[v] - EC_TABLE[v][ecIdx];
      if (dataLength <= capacity) return v;
    }
    return 40;
  }

  function getSize(version) {
    return 17 + version * 4;
  }

  // Encode data as byte mode
  function encodeData(text, version, ecLevel) {
    const ecIdx = EC_LEVEL[ecLevel] || 0;
    const totalCodewords = DATA_CAPACITY[version];
    const ecCodewords = EC_TABLE[version][ecIdx];
    const dataCodewords = totalCodewords - ecCodewords;

    const bytes = new TextEncoder().encode(text);
    const bits = [];

    // Mode indicator: byte mode = 0100
    bits.push(0, 1, 0, 0);

    // Character count (8 bits for v1-9, 16 for v10+)
    const countBits = version <= 9 ? 8 : 16;
    for (let i = countBits - 1; i >= 0; i--) {
      bits.push((bytes.length >> i) & 1);
    }

    // Data
    for (const byte of bytes) {
      for (let i = 7; i >= 0; i--) {
        bits.push((byte >> i) & 1);
      }
    }

    // Terminator
    const maxBits = dataCodewords * 8;
    for (let i = 0; i < 4 && bits.length < maxBits; i++) {
      bits.push(0);
    }

    // Pad to byte boundary
    while (bits.length % 8 !== 0 && bits.length < maxBits) {
      bits.push(0);
    }

    // Pad codewords
    const padBytes = [0xec, 0x11];
    let padIdx = 0;
    while (bits.length < maxBits) {
      for (let i = 7; i >= 0; i--) {
        bits.push((padBytes[padIdx] >> i) & 1);
      }
      padIdx = 1 - padIdx;
    }

    // Convert to bytes
    const codewords = new Uint8Array(dataCodewords);
    for (let i = 0; i < dataCodewords; i++) {
      let byte = 0;
      for (let j = 0; j < 8; j++) {
        byte = (byte << 1) | (bits[i * 8 + j] || 0);
      }
      codewords[i] = byte;
    }

    // Generate EC codewords
    const gen = generatorPoly(ecCodewords);
    const dividend = new Uint8Array(dataCodewords + ecCodewords);
    dividend.set(codewords);
    const ec = polyDiv(dividend, gen);

    // Interleave (simplified for single block)
    const result = new Uint8Array(totalCodewords);
    result.set(codewords);
    result.set(ec, dataCodewords);

    return result;
  }

  function createMatrix(version) {
    const size = getSize(version);
    // 0 = white, 1 = black, 2 = unset
    const matrix = Array.from({ length: size }, () => new Uint8Array(size).fill(2));
    return matrix;
  }

  function addFinderPattern(matrix, row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const mr = row + r, mc = col + c;
        if (mr < 0 || mr >= matrix.length || mc < 0 || mc >= matrix.length) continue;
        const isBlack =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        matrix[mr][mc] = isBlack ? 1 : 0;
      }
    }
  }

  function addTimingPatterns(matrix) {
    const size = matrix.length;
    for (let i = 8; i < size - 8; i++) {
      const val = i % 2 === 0 ? 1 : 0;
      if (matrix[6][i] === 2) matrix[6][i] = val;
      if (matrix[i][6] === 2) matrix[i][6] = val;
    }
  }

  function addAlignmentPatterns(matrix, version) {
    if (version < 2) return;
    const positions = getAlignmentPositions(version);
    for (const row of positions) {
      for (const col of positions) {
        if (matrix[row][col] !== 2) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const isBlack =
              Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
            matrix[row + r][col + c] = isBlack ? 1 : 0;
          }
        }
      }
    }
  }

  function getAlignmentPositions(version) {
    if (version === 1) return [];
    const intervals = Math.floor(version / 7) + 1;
    const size = getSize(version);
    const step = Math.ceil((size - 13) / (intervals * 2)) * 2;
    const positions = [6];
    let pos = size - 7;
    for (let i = 0; i < intervals; i++) {
      positions.splice(1, 0, pos);
      pos -= step;
    }
    return positions;
  }

  function reserveFormatArea(matrix) {
    const size = matrix.length;
    for (let i = 0; i < 8; i++) {
      if (matrix[8][i] === 2) matrix[8][i] = 0;
      if (matrix[i][8] === 2) matrix[i][8] = 0;
      if (matrix[8][size - 1 - i] === 2) matrix[8][size - 1 - i] = 0;
      if (matrix[size - 1 - i][8] === 2) matrix[size - 1 - i][8] = 0;
    }
    if (matrix[8][8] === 2) matrix[8][8] = 0;
    matrix[size - 8][8] = 1; // Dark module
  }

  function placeData(matrix, data) {
    const size = matrix.length;
    let bitIdx = 0;
    const totalBits = data.length * 8;

    let col = size - 1;
    let goingUp = true;

    while (col >= 0) {
      if (col === 6) col--; // Skip timing column

      for (let row = 0; row < size; row++) {
        const r = goingUp ? size - 1 - row : row;
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (cc < 0) continue;
          if (matrix[r][cc] !== 2) continue;
          if (bitIdx < totalBits) {
            const byteIdx = Math.floor(bitIdx / 8);
            const bitPos = 7 - (bitIdx % 8);
            matrix[r][cc] = (data[byteIdx] >> bitPos) & 1;
            bitIdx++;
          } else {
            matrix[r][cc] = 0;
          }
        }
      }

      col -= 2;
      goingUp = !goingUp;
    }
  }

  function applyMask(matrix, maskNum) {
    const size = matrix.length;
    const masks = [
      (r, c) => (r + c) % 2 === 0,
      (r, c) => r % 2 === 0,
      (r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
      (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
      (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
    ];
    const fn = masks[maskNum];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (isDataModule(matrix, r, c, size)) {
          if (fn(r, c)) {
            matrix[r][c] ^= 1;
          }
        }
      }
    }
  }

  function isDataModule(matrix, r, c, size) {
    // Skip finder patterns + separators
    if (r <= 8 && c <= 8) return false;
    if (r <= 8 && c >= size - 8) return false;
    if (r >= size - 8 && c <= 8) return false;
    // Skip timing
    if (r === 6 || c === 6) return false;
    return true;
  }

  function addFormatInfo(matrix, ecLevel, maskNum) {
    const ecBits = [1, 0, 3, 2][EC_LEVEL[ecLevel] || 0];
    let data = (ecBits << 3) | maskNum;

    // BCH(15, 5)
    let bch = data;
    for (let i = 4; i >= 0; i--) {
      if (bch & (1 << (i + 10))) {
        bch ^= 0x537 << i;
      }
    }
    const formatBits = ((data << 10) | bch) ^ 0x5412;

    const size = matrix.length;
    // Horizontal
    for (let i = 0; i < 6; i++) matrix[8][i] = (formatBits >> i) & 1;
    matrix[8][7] = (formatBits >> 6) & 1;
    matrix[8][8] = (formatBits >> 7) & 1;
    matrix[7][8] = (formatBits >> 8) & 1;
    for (let i = 9; i < 15; i++) matrix[14 - i][8] = (formatBits >> i) & 1;

    // Vertical
    for (let i = 0; i < 8; i++) matrix[size - 1 - i][8] = (formatBits >> i) & 1;
    for (let i = 8; i < 15; i++) matrix[8][size - 15 + i] = (formatBits >> i) & 1;
  }

  function generate(text, ecLevel = 'M') {
    const bytes = new TextEncoder().encode(text);
    // Byte mode overhead: 4 (mode) + count bits + data
    const version = getVersion(bytes.length + 3, ecLevel);
    const data = encodeData(text, version, ecLevel);
    const matrix = createMatrix(version);
    const size = getSize(version);

    addFinderPattern(matrix, 0, 0);
    addFinderPattern(matrix, 0, size - 7);
    addFinderPattern(matrix, size - 7, 0);
    addTimingPatterns(matrix);
    addAlignmentPatterns(matrix, version);
    reserveFormatArea(matrix);
    placeData(matrix, data);

    // Use mask 0 (simple, produces reasonable results)
    const maskNum = 0;
    applyMask(matrix, maskNum);
    addFormatInfo(matrix, ecLevel, maskNum);

    return matrix;
  }

  function renderToCanvas(canvas, text, options = {}) {
    const {
      ecLevel = 'M',
      cellSize = 4,
      margin = 4,
      darkColor = '#0d1117',
      lightColor = '#ffffff',
    } = options;

    const matrix = generate(text, ecLevel);
    const size = matrix.length;
    const canvasSize = (size + margin * 2) * cellSize;

    canvas.width = canvasSize;
    canvas.height = canvasSize;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = lightColor;
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    ctx.fillStyle = darkColor;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c] === 1) {
          ctx.fillRect(
            (c + margin) * cellSize,
            (r + margin) * cellSize,
            cellSize,
            cellSize
          );
        }
      }
    }
  }

  return { generate, renderToCanvas };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = QRCode;
}
