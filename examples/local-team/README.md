# Local Team

Two agents (a lead and a coder) running on a model served by your own
[llama.cpp](https://github.com/ggml-org/llama.cpp) server. Nothing leaves your
machine and no API key is needed.

## Run it

1. Start llama.cpp with tool calling enabled (`--jinja`):

   ```bash
   llama-server -m ~/models/qwen3-coder-30b-Q4_K_M.gguf --jinja -c 32768 --port 8080
   ```

2. Check the model id it serves and put it in `office.yaml` (`default_model`):

   ```bash
   curl http://127.0.0.1:8080/v1/models
   ```

3. Start the office:

   ```bash
   cp -r examples/local-team/ ~/.agent-office/offices/local-team/
   pnpm dev start --office local-team
   ```

## vLLM instead

Use `vllm:<model-id>` as the model. vLLM listens on port 8000 by default and
needs tool calling enabled:

```bash
vllm serve Qwen/Qwen3-32B --enable-auto-tool-choice --tool-call-parser hermes
```

## Docker sandbox

With `--sandbox docker`, agents reach your machine through
`host.docker.internal`, so start the server with `--host 0.0.0.0` instead of
the default `127.0.0.1`.

See [Local Models](../../README.md#local-models-llamacpp--vllm) in the main
README for every option.
