"""Speech service for agent-office voice calls: speech-to-text and text-to-speech
on the CPU (no GPU memory), so the GPU stays free for the agents' model.

  WebSocket /stt   send 16 kHz mono s16le audio as binary messages while the
                   person talks, then the text "end"; the reply is
                   {"text": "..."}.
  POST /tts        {"text": "...", "voice": "alba"} -> 24 kHz mono s16le audio,
                   streamed as it's made. Closing the request stops it.
  GET /health      {"ok": true, "voices": [...]}

Models: NVIDIA Nemotron Speech Streaming 0.6B (sherpa-onnx) and Kyutai Pocket
TTS. Both load once at start-up.
"""

import asyncio
import json
import os
import threading
import time

import numpy as np
import sherpa_onnx
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse
from pocket_tts import TTSModel
from pydantic import BaseModel

ASR_DIR = os.environ.get("ASR_DIR", "/models/asr")
STT_THREADS = int(os.environ.get("STT_THREADS", "4"))
TTS_THREADS = int(os.environ.get("TTS_THREADS", "4"))
# Voices loaded at start-up; others load the first time they're asked for.
PRELOAD = [v for v in os.environ.get("TTS_PRELOAD", "alba,marius").split(",") if v]
# Silence fed after the last audio so the model finishes the last word.
TAIL_SECONDS = 0.4
RATE = 16000

torch.set_num_threads(TTS_THREADS)

t0 = time.time()
recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
    tokens=f"{ASR_DIR}/tokens.txt",
    encoder=f"{ASR_DIR}/encoder.int8.onnx",
    decoder=f"{ASR_DIR}/decoder.int8.onnx",
    joiner=f"{ASR_DIR}/joiner.int8.onnx",
    num_threads=STT_THREADS,
    provider="cpu",
)
print(f"[voice] Speech recognition ready ({time.time() - t0:.1f} s)", flush=True)

t0 = time.time()
tts = TTSModel.load_model()
voices: dict = {}
tts_lock = threading.Lock()
stt_lock = threading.Lock()


def voice_state(name: str):
    if name not in voices:
        voices[name] = tts.get_state_for_audio_prompt(name)
    return voices[name]


for v in PRELOAD:
    voice_state(v)
print(
    f"[voice] Speech synthesis ready ({time.time() - t0:.1f} s), voices: {', '.join(voices)}",
    flush=True,
)

app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True, "voices": sorted(voices)}


def decode(stream) -> None:
    with stt_lock:
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)


@app.websocket("/stt")
async def stt(ws: WebSocket):
    await ws.accept()
    stream = recognizer.create_stream()
    started = time.time()
    seconds = 0.0
    try:
        while True:
            msg = await ws.receive()
            if msg.get("bytes"):
                pcm = np.frombuffer(msg["bytes"], dtype=np.int16)
                seconds += len(pcm) / RATE
                stream.accept_waveform(RATE, pcm.astype(np.float32) / 32768)
                await asyncio.to_thread(decode, stream)
            elif msg.get("text") == "end":
                ended = time.time()
                stream.accept_waveform(RATE, np.zeros(int(RATE * TAIL_SECONDS), np.float32))
                stream.input_finished()
                await asyncio.to_thread(decode, stream)
                text = recognizer.get_result(stream).strip()
                print(
                    f"[voice] Heard {seconds:.1f} s in {time.time() - started:.1f} s, "
                    f"done {int((time.time() - ended) * 1000)} ms after the end: {text[:80]!r}",
                    flush=True,
                )
                await ws.send_text(json.dumps({"text": text}))
                await ws.close()
                return
            elif msg.get("type") == "websocket.disconnect":
                return
    except WebSocketDisconnect:
        return


class Speak(BaseModel):
    text: str
    voice: str = "alba"


@app.post("/tts")
async def speak(req: Speak):
    text = req.text.strip()
    if not text:
        return JSONResponse({"error": "no text"}, status_code=400)
    try:
        state = await asyncio.to_thread(voice_state, req.voice)
    except Exception as err:  # unknown voice name or file
        return JSONResponse({"error": f"voice {req.voice!r}: {err}"}, status_code=400)

    stop = threading.Event()
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def generate():
        started = time.time()
        first = None
        samples = 0
        try:
            with tts_lock:
                for chunk in tts.generate_audio_stream(state, text, stop=stop):
                    if first is None:
                        first = time.time() - started
                    pcm = (chunk.clamp(-1, 1) * 32767).to(torch.int16).numpy().tobytes()
                    samples += len(pcm) // 2
                    loop.call_soon_threadsafe(queue.put_nowait, pcm)
            if first is not None:
                print(
                    f"[voice] Spoke {samples / tts.sample_rate:.1f} s in {time.time() - started:.1f} s, "
                    f"first audio after {int(first * 1000)} ms ({req.voice})",
                    flush=True,
                )
        except Exception as err:
            print(f"[voice] Speech failed: {err}", flush=True)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=generate, daemon=True).start()

    async def body():
        try:
            while (pcm := await queue.get()) is not None:
                yield pcm
        finally:
            stop.set()  # the caller hung up (interrupted): stop generating

    return StreamingResponse(
        body(),
        media_type="audio/L16",
        headers={"X-Sample-Rate": str(tts.sample_rate)},
    )
