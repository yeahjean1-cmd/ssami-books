import { uid } from '../model/factory';
import type { Asset } from '../model/types';
import { notify } from '../store/store';
import { pickFile, readFile } from './fields';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** data URL 이미지를 열어 크기를 확인하고 프로젝트 에셋으로 만든다. */
export async function assetFromDataUrl(dataUrl: string, mime: string, name: string): Promise<Asset> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { id: uid(), name, mime, dataUrl, pxW: img.naturalWidth, pxH: img.naturalHeight };
}

export async function pickImageAsset(): Promise<Asset | null> {
  const file = await pickFile('.jpg,.jpeg,.png,.webp');
  if (!file) return null;
  if (!IMAGE_TYPES.includes(file.type)) {
    notify('JPG, PNG, WEBP 이미지만 넣을 수 있어요.', 'error');
    return null;
  }
  try {
    return await assetFromDataUrl(await readFile(file, 'dataUrl'), file.type, file.name);
  } catch {
    notify('이미지를 열지 못했어요. 파일이 손상되었을 수 있어요.', 'error');
    return null;
  }
}
