# agent-office voice service: speech-to-text and text-to-speech on the CPU.
# Started by docker compose when COMPOSE_PROFILES includes "voice".

FROM python:3.12-slim

# CPU-only PyTorch: the CUDA build would add gigabytes and could touch the GPU.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install --no-cache-dir "sherpa-onnx>=1.13.4" "pocket-tts>=3.3" "uvicorn[standard]"

# Speech recognition: Nemotron Speech Streaming EN 0.6B, int8, 160 ms chunks.
ARG ASR_REPO=csukuangfj2/sherpa-onnx-nemotron-speech-streaming-en-0.6b-160ms-int8-2026-04-25
RUN mkdir -p /models/asr && cd /models/asr \
    && for f in encoder.int8.onnx decoder.int8.onnx joiner.int8.onnx tokens.txt; do \
         python -c "import urllib.request,sys; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" \
           "https://huggingface.co/${ASR_REPO}/resolve/main/$f" "$f" || exit 1; \
       done

# Speech synthesis: download Pocket TTS and its stock voices now, not on first use.
ENV HF_HOME=/models/hf
RUN python -c "from pocket_tts import TTSModel; m = TTSModel.load_model(); \
[m.get_state_for_audio_prompt(v) for v in ('alba','marius','javert','jean','cosette','anna','vera','fantine','charles','paul','eponine','azelma','george','mary','jane','michael','eve')]"

WORKDIR /app
COPY server.py .
ENV HF_HUB_OFFLINE=1 PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning"]
