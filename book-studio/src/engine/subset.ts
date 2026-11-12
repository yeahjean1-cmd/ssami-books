// 폰트 서브셋: PDF에 실제로 쓰인 글자만 담는다. HarfBuzz(hb-subset) WebAssembly를 사용한다.
// (pdf-lib 내장 서브셋은 한글 글리프를 빠뜨리는 문제가 있어 사용하지 않는다.)

export type WasmSource = () => Promise<BufferSource>;

let instance: Promise<any> | null = null;

function load(source: WasmSource): Promise<any> {
  instance ??= source()
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then((r: any) => {
      const ex = (r.instance ?? r).exports;
      ex._initialize?.();
      return ex;
    });
  instance.catch(() => (instance = null));
  return instance;
}

export async function subsetFont(data: Uint8Array, codePoints: Iterable<number>, source: WasmSource): Promise<Uint8Array> {
  const hb = await load(source);
  const ptr = hb.malloc(data.byteLength);
  new Uint8Array(hb.memory.buffer).set(data, ptr);
  const blob = hb.hb_blob_create(ptr, data.byteLength, 2 /* WRITABLE */, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  const input = hb.hb_subset_input_create_or_fail();
  let subset = 0;
  try {
    if (!input) throw new Error('폰트 서브셋을 준비하지 못했어요.');
    const set = hb.hb_subset_input_unicode_set(input);
    for (const cp of codePoints) hb.hb_set_add(set, cp);
    subset = hb.hb_subset_or_fail(face, input);
    if (!subset) throw new Error('폰트 서브셋을 만들지 못했어요.');
    const out = hb.hb_face_reference_blob(subset);
    const len = hb.hb_blob_get_length(out);
    const start = hb.hb_blob_get_data(out, 0);
    if (!len) throw new Error('폰트 서브셋 결과가 비어 있어요.');
    // 파일 끝에 놓인 빈 글리프(공백 등)를 fontkit이 읽다가 범위를 벗어나지 않도록 0으로 채운 여유를 둔다.
    const result = new Uint8Array(len + 12);
    result.set(new Uint8Array(hb.memory.buffer, start, len));
    hb.hb_blob_destroy(out);
    return result;
  } finally {
    if (subset) hb.hb_face_destroy(subset);
    if (input) hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.hb_blob_destroy(blob);
    hb.free(ptr);
  }
}
