// SPDX-License-Identifier: Apache-2.0

export const MODEL_CATALOG_SCHEMA = 'course.local-model-catalog/v1';

export const QWEN_MODEL_CATALOG = Object.freeze([
  Object.freeze({
    id: 'qwen3-0.6b-q4',
    label: 'Qwen3 0.6B',
    capability: 'Quick evaluation',
    guidance: 'Fastest option for trying the complete local workflow.',
    memoryBytes: 1_000_000_000,
    bytes: 396_705_472,
    file: 'Qwen3-0.6B-Q4_K_M.gguf',
    model: 'Qwen3-0.6B-Q4_K_M',
    revision: '50968a4468ef4233ed78cd7c3de230dd1d61a56b',
    sha256: 'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a',
    url: 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_K_M.gguf',
    source: 'unsloth/Qwen3-0.6B-GGUF',
  }),
  Object.freeze({
    id: 'qwen3-1.7b-q8',
    label: 'Qwen3 1.7B',
    capability: 'Balanced local drafting',
    guidance: 'Better instruction following with a moderate memory footprint.',
    memoryBytes: 3_000_000_000,
    bytes: 1_834_426_016,
    file: 'Qwen3-1.7B-Q8_0.gguf',
    model: 'Qwen3-1.7B-Q8_0',
    revision: '90862c4b9d2787eaed51d12237eafdfe7c5f6077',
    sha256: '061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a',
    url: 'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf',
    source: 'Qwen/Qwen3-1.7B-GGUF',
  }),
  Object.freeze({
    id: 'qwen3-4b-q4',
    label: 'Qwen3 4B',
    capability: 'Stronger course design',
    guidance: 'Best quality option in this starter catalog; generation is slower.',
    memoryBytes: 4_500_000_000,
    bytes: 2_497_280_256,
    file: 'Qwen3-4B-Q4_K_M.gguf',
    model: 'Qwen3-4B-Q4_K_M',
    revision: 'bc640142c66e1fdd12af0bd68f40445458f3869b',
    sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
    url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf',
    source: 'Qwen/Qwen3-4B-GGUF',
  }),
]);

export function modelById(id) {
  return QWEN_MODEL_CATALOG.find((model) => model.id === id) ?? null;
}
