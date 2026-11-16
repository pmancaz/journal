# Third-party acknowledgements

Journal's application code retains its existing [MIT licence](../LICENSE). The licences below apply to the respective upstream work, not to a new grant by this project. Models, environments and runtime binaries are not included in this source repository.

| Work | Use | Upstream licence |
| --- | --- | --- |
| [React](https://github.com/facebook/react) | Local writing interface | [MIT](https://github.com/facebook/react/blob/main/LICENSE) |
| [TipTap](https://github.com/ueberdosis/tiptap) and [ProseMirror](https://github.com/ProseMirror/prosemirror-view) | Rich-text editor | [MIT](https://github.com/ueberdosis/tiptap/blob/main/LICENSE.md), [MIT](https://github.com/ProseMirror/prosemirror-view/blob/master/LICENSE) |
| [TypeScript](https://github.com/microsoft/TypeScript) | Frontend source and checking | [Apache-2.0](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) |
| [Vite](https://github.com/vitejs/vite) and [Vitest](https://github.com/vitest-dev/vitest) | Web build and tests | [MIT](https://github.com/vitejs/vite/blob/main/LICENSE), [MIT](https://github.com/vitest-dev/vitest/blob/main/LICENSE) |
| [Tauri](https://github.com/tauri-apps/tauri) | Earlier desktop shell | [MIT or Apache-2.0](https://github.com/tauri-apps/tauri#licenses) |
| [IBM Plex Mono](https://github.com/IBM/plex) | Bundled font assets in the earlier interface | [SIL Open Font License 1.1](../public/fonts/OFL.txt), copyright IBM Corp., reserved font name Plex |
| [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) by the Qwen team | Optional theme names and daily summaries | [Apache-2.0](https://huggingface.co/Qwen/Qwen3.5-9B/blob/main/LICENSE) |
| [mlx-community/Qwen3.5-9B-MLX-4bit](https://huggingface.co/mlx-community/Qwen3.5-9B-MLX-4bit) | Local 4-bit MLX conversion used by the worker | [Apache-2.0](https://huggingface.co/mlx-community/Qwen3.5-9B-MLX-4bit) |
| [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) by the Sentence Transformers contributors | Optional 384-dimensional text embeddings, ARM64 int8 ONNX | [Apache-2.0](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) |
| [MLX](https://github.com/ml-explore/mlx) and [MLX-LM](https://github.com/ml-explore/mlx-lm) | Local Apple Silicon language-model inference | [MIT](https://github.com/ml-explore/mlx/blob/main/LICENSE), [MIT](https://github.com/ml-explore/mlx-lm/blob/main/LICENSE) |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | Local CPU embedding inference | [MIT](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |
| [Transformers](https://github.com/huggingface/transformers) and [Tokenizers](https://github.com/huggingface/tokenizers) | Local model/tokenizer support | [Apache-2.0](https://github.com/huggingface/transformers/blob/main/LICENSE), [Apache-2.0](https://github.com/huggingface/tokenizers/blob/main/LICENSE) |
| [NumPy](https://github.com/numpy/numpy) | Embedding calculations | [BSD-3-Clause](https://github.com/numpy/numpy/blob/main/LICENSE.txt) |

Apple's SwiftUI, Charts, WebKit and AppKit are system frameworks supplied under Apple's terms. Python and SQLite are supplied through the user's local runtime. The dependency lockfiles describe the fuller transitive dependency trees; upstream notices continue to apply.

The optional AI setup currently shares a prepared Kokoro.app reading/chat environment. It uses that application's Qwen model and Python packages; it does not use the Kokoro speech-synthesis model. Downloads occur during setup. The analysis worker itself uses local files with offline model settings.

Screenshots in `docs/images/` show the working native application with original example text created for publication. Theme labels and summaries in the demo are actual local-model output from that example journal. They are illustrative and approximate, not benchmarks or personal journal extracts.
