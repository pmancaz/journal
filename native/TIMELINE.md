# Thought timeline — local analysis

Open **Recurring themes** in journal’s toolbar. It is a separate
SwiftUI/Swift Charts window. **Sync now** reads the saved local recovery draft and
updates the analysis. The clock button changes or disables the daily schedule.

The optional daily job runs at **12:00 local time** while the user is signed in,
including when Journal is closed. macOS coalesces missed calendar triggers after
sleep; it does not wake a powered-off Mac. The job is a user LaunchAgent, not a
Codex automation or a remote AI service.

## Reading the view

- One lane per recurring topic, with dots on dates where writing matches it.
- Dot area reflects the fraction of that day's text chunks assigned to the topic,
  not importance, mood, confidence, or continuous thought between entries.
- Choose 3 months, a year, or all dates. Click a dot to see the date and theme.
- Theme chips show first/last appearances and the number of distinct writing days.
- The details panel shows the summary, actual supporting passages, and a button
  to open that entry in the journal.
- All historical writing is embedded and matched to recurring topics. Initial
  detailed language-model summaries cover the most recent seven writing days.
  **Summarize this day** generates a closer summary for any earlier day on demand.
- Theme matches are approximate. Detailed summaries can reject a merely nearest
  theme, and unrelated writing can have no theme match. No diagnosis or sentiment
  score is generated.

## Models and execution

The current implementation targets Apple Silicon and reuses a prepared Kokoro reading/chat runtime. Writing works without these resources. The setup script does not install Qwen or the shared MLX packages for a new user; see the [main setup instructions](../README.md#optional-local-ai-setup).

- Interpretation: the already-installed **mlx-community/Qwen3.5-9B-MLX-4bit**
  model and MLX Python packages in Kokoro. It is Kokoro's reading/chat model,
  rather than its speech-synthesis model. Weights are shared, not duplicated.
- Semantic embeddings: **sentence-transformers/all-MiniLM-L6-v2**, quantized
  ARM64 ONNX, 384 dimensions. Chunks are mean-pooled with the attention mask and
  normalized. The model's SHA-256 was verified against Hugging Face's file metadata.
- ONNX Runtime 1.23.2 runs on CPU with four inference threads. Qwen uses MLX/Metal.
  The language model loads only when needed and exits after the job. Unchanged
  cached days do not need language-model inference again.
- Qwen source: https://huggingface.co/Qwen/Qwen3.5-9B
- MLX conversion: https://huggingface.co/mlx-community/Qwen3.5-9B-MLX-4bit
- Embedding model: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2

The worker uses local model paths, `local_files_only`, offline Hugging Face and
Transformers settings, no telemetry, and no HTTP model endpoint. Journal content
is not uploaded. Kokoro must remain installed for the shared language model and
MLX packages to remain available. The dedicated TimelineRuntime Python 3.11 venv holds ONNX dependencies. The shared packages must be compatible with that Python version.

## Data boundaries

Everything below is inside the user's local Application Support folder for
`com.pcjournal.native-preview`:

- Source: `preview-draft.html` — opened **read-only** by the worker.
- Journal identity: `journal-id.txt`; a new import gets its own analysis identity.
- Derivatives: `Timeline/timeline.sqlite`, `timeline-<journal-id>.json`.
- Run status: `Timeline/status.json`; logs contain status/errors, not diary dumps.
- Configuration: `Timeline/config.json`.
- Embeddings: `TimelineModels/MiniLM/` and its source/license records.
- Python environment: `TimelineRuntime/`.

The worker has no journal-writing function. It hashes each day's actual text,
reuses unchanged vectors, refreshes changed days, groups same-date sections, and
ignores scripts/styles, image bytes, and empty dated entries. A file lock prevents
overlapping manual and scheduled runs. Derived writes are transactional/atomic.
Cancellation keeps completed cached work. The model's source references are
checked against actual supplied passages; invalid references are withheld.

Historical themes start as deterministic semantic clusters. Qwen names them from
representative passages. New distant ideas may add a thread, up to a bounded
fourteen-thread overview. The chart is an interpretation to explore, not an
exhaustive or fixed taxonomy of the journal.

## Schedule and checks

The launch agent is `~/Library/LaunchAgents/com.pcjournal.native-preview.timeline.plist`.
The in-app clock popover controls it. For developer setup/removal:

```sh
# Use Python 3.11 (the installed uv-managed Python works).
python3.11 native/setup_timeline.py
python3 native/install_timeline_schedule.py --state-dir "$HOME/Library/Application Support/com.pcjournal.native-preview/Timeline"
python3 native/install_timeline_schedule.py --state-dir "$HOME/Library/Application Support/com.pcjournal.native-preview/Timeline" --disable
```

The isolated regression suite covers parsing, source-reference validation, short journals, deterministic clustering, cache invalidation, incremental updates, source preservation, setup failures, schedule rollback and native store/persistence behaviour. Run `native/check.sh` as described in [native development](README.md). These checks do not load models or verify real inference.

The Qwen model and MLX conversion and the MiniLM embedding model are Apache-2.0 licensed. Dependencies have separate licences; see [acknowledgements](../docs/ACKNOWLEDGEMENTS.md). No weights are included in the repository.
