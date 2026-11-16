# Fine-tuning the DanfoAI chat model

What the model is for: DanfoAI never lets the model work out a route or a fare.
The planner computes the trip; the model only rewords the computed answer, and
`replyKeepsFacts()` throws its reply away if a stop or a fare changed. Today
only English goes through the model — Pidgin, Yoruba, Igbo and Hausa come from
templates, because the base model can't write them reliably. Fine-tuning is how
those four move to the model.

Nothing in this folder has been run yet. It needs a funded 0G wallet (or any
GPU), which this repo does not hold.

## 1. Build the dataset

```bash
npm run build:training                      # ~4,500 train / ~490 eval examples
TRAINING_PAIRS=600 npm run build:training   # a smaller, cheaper first run
```

This writes to `training/` (git-ignored) and prints the size of the training
file in tokens with the cost per epoch at 0G's list prices. Use
`training/grounded.train.jsonl` — the production task, in the `messages` chat
format 0G fine-tuning accepts.

## 2. Train on 0G Compute

0G fine-tuning currently offers two base models: `Qwen2.5-0.5B-Instruct`
(0.5 0G per million tokens — a cheap way to prove the pipeline) and `Qwen3-32B`
(4 0G per million tokens — the one worth deploying). Confirm with `list-models`;
the list changes.

```bash
npm install -g @0glabs/0g-serving-broker      # the 0g-compute-cli
0g-compute-cli setup-network
0g-compute-cli login
0g-compute-cli fine-tuning list-providers
0g-compute-cli fine-tuning list-models

0g-compute-cli deposit --amount <0G>
# --service fine-tuning is required, or the funds go to the inference account
0g-compute-cli transfer-fund --provider <PROVIDER> --amount <0G> --service fine-tuning

0g-compute-cli fine-tuning create-task \
  --provider <PROVIDER> \
  --model Qwen3-32B \
  --dataset-path ./training/grounded.train.jsonl \
  --config-path ./finetune/training_config.json

0g-compute-cli fine-tuning get-task --provider <PROVIDER> --task <TASK_ID>
0g-compute-cli fine-tuning get-log  --provider <PROVIDER> --task <TASK_ID>
```

When the task is `Delivered` you have **48 hours** to collect the model, or it
is lost and part of the fee is kept:

```bash
0g-compute-cli fine-tuning acknowledge-model --provider <PROVIDER> --task-id <TASK_ID> --data-path ./finetune/models/
# wait about a minute for the task to reach Finished, then:
0g-compute-cli fine-tuning decrypt-model --provider <PROVIDER> --task-id <TASK_ID> \
  --encrypted-model ./finetune/models/lora_model_<TASK_ID>.zip --output ./finetune/models/decrypted.zip
unzip ./finetune/models/decrypted.zip -d ./finetune/models/lora_adapter
```

`finetune/training_config.json` uses the five fields 0G's template allows (do
not add or remove any). `max_steps: -1` means "train for `num_train_epochs`";
for a first smoke test set it to a small number such as 30.

What comes back is a **LoRA adapter** (`adapter_model.safetensors` plus
tokenizer files), not a hosted model. 0G's inference providers do not serve it
for you: it has to be loaded on top of the same base model somewhere that
exposes an OpenAI-compatible API (vLLM: `--lora-modules danfo=./lora_adapter/output_model`).

The same JSONL trains anywhere else that takes chat-format data (Hugging Face
TRL/PEFT on a rented GPU or Colab), if a 0G run is not possible.

## 3. Measure it before it answers a rider

```bash
npm run eval:model -- --self-test     # checks the scorer; needs no model

MODEL_BASE_URL=http://<host>:8000/v1 MODEL_NAME=danfo npm run eval:model
```

`eval:model` replays the held-out trips against the endpoint with the exact
system prompt the app sends and applies the production fact check to every
reply. It prints a pass rate per language and the `MODEL_REPLY_LANGUAGES` value
those results justify. Run it on the base model first, so there is a number to
beat. Failing replies land in `training/eval-failures.jsonl`.

## 4. Switch languages on

Set `MODEL_REPLY_LANGUAGES` (for example `en,pcm,yo`) to the languages that
passed. Anything not listed keeps coming from the planner's templates, and
every model reply is still fact-checked at request time, so a weak language can
cost a rider nothing worse than the template answer.

`/api/chat` currently talks to a 0G inference provider only. Pointing it at a
self-hosted adapter is a deliberate decision for the maintainers — it moves
inference off 0G Compute's verified providers — and is not wired up here.
