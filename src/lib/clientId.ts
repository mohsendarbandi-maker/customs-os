const randomByte = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');

export const makeClientId = () => {
  const bytes = Array.from({ length: 16 }, randomByte);
  bytes[6] = ((parseInt(bytes[6], 16) & 0x0f) | 0x40).toString(16).padStart(2, '0');
  bytes[8] = ((parseInt(bytes[8], 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${bytes.slice(0, 4).join('')}-${bytes.slice(4, 6).join('')}-${bytes.slice(6, 8).join('')}-${bytes.slice(8, 10).join('')}-${bytes.slice(10).join('')}`;
};
