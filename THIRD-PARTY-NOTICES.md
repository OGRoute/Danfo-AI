# Third-party notices

The [MIT license](LICENSE) covers DanfoAI's own source code only. DanfoAI
integrates with third-party projects and models that carry their own terms.

## YarnGPT — Nigerian text-to-speech

<https://github.com/saheedniyi02/yarngpt>

**Not redistributed in this repository.** It is fetched at setup time by
[`services/speech/fetch-yarngpt.sh`](services/speech/fetch-yarngpt.sh) and is
gitignored. At the time of writing it publishes no license; review its
repository before any redistribution or commercial use.

## Models downloaded at runtime

OpenAI Whisper / faster-whisper, WavTokenizer, and any Hugging Face models the
speech service pulls on first run are each under their own license.

## Dependencies

Soroban SDK, Stellar SDK, Next.js and the rest of the dependency tree are under
the licenses declared in their respective packages.

---

Contributors are responsible for ensuring any code or assets they add are
compatible with the MIT license above.
