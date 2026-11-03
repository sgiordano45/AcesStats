// js/core/heic.js
// iPhones save photos as HEIC. Safari and iOS show HEIC, but Chrome, Edge
// and Firefox on desktop do not, so a HEIC upload shows as a blank tile for
// most of the league. iOS sometimes hands the browser a HEIC file named
// IMG_1234.jpg with type image/jpeg, so the name and type cannot be trusted:
// we check the file's first bytes instead.
//
//   const file = await toJpegIfHeic(input.files[0]);
//
// Returns the original file when it is not HEIC, or a new JPEG File.

const HEIC_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'];
const HEIC2ANY_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';

export async function isHeic(file) {
  if (!file || !(file.type || '').startsWith('image/') && !/\.(heic|heif)$/i.test(file.name || '')) return false;
  if (/image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '')) return true;
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const box = String.fromCharCode(...head.slice(4, 8));
    const brand = String.fromCharCode(...head.slice(8, 12));
    return box === 'ftyp' && HEIC_BRANDS.includes(brand);
  } catch {
    return false;
  }
}

function jpegName(name) {
  return (name || 'photo').replace(/\.(heic|heif|jpe?g|png)$/i, '') + '.jpg';
}

// Safari can decode HEIC itself, which is faster than loading the library.
async function nativeToJpeg(file) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.9));
}

let libPromise = null;
function loadHeic2any() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  if (!libPromise) {
    libPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = HEIC2ANY_URL;
      s.onload = () => (window.heic2any ? res(window.heic2any) : rej(new Error('heic2any missing')));
      s.onerror = () => { libPromise = null; rej(new Error('Could not load the HEIC converter')); };
      document.head.appendChild(s);
    });
  }
  return libPromise;
}

export async function heicToJpegBlob(blob) {
  try {
    return await nativeToJpeg(blob);
  } catch {
    const heic2any = await loadHeic2any();
    const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.9 });
    return Array.isArray(out) ? out[0] : out;
  }
}

export async function toJpegIfHeic(file) {
  if (!(await isHeic(file))) return file;
  const blob = await heicToJpegBlob(file);
  return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
}
