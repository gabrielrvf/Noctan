import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const sherpa = require("sherpa-onnx-node");
const root = workerData.modelDir;
const model = (file) => join(root, file);
let recognizer, stream;
let committed = "";
function normalize(t) { return String(t || "").replace(/<[^>]+>/g, "").trim(); }
try {
  recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 128 },
    modelConfig: {
      transducer: {
        encoder: model("encoder.int8.onnx"),
        decoder: model("decoder.int8.onnx"),
        joiner: model("joiner.int8.onnx"),
      },
      tokens: model("tokens.txt"),
      numThreads: 2,
      provider: "cpu",
      debug: 0,
    },
    enableEndpoint: true,
    rule2MinTrailingSilence: 0.9,
    rule3MinUtteranceLength: 18,
  });
  stream = recognizer.createStream();
  if (typeof stream.setOption === "function") stream.setOption("language", "pt-BR");
  parentPort.postMessage({ type: "ready" });
} catch (e) {
  parentPort.postMessage({ type: "error", error: String(e?.message || e) });
}
let finalizing = false;
let lastText = "";
let lastPartialAt = 0;
function publishText(type, text) {
  if (type === "final") { parentPort.postMessage({ type, text }); return; }
  const now = Date.now();
  if (text === lastText || now - lastPartialAt < 115) return;
  lastText = text;
  lastPartialAt = now;
  parentPort.postMessage({ type, text });
}
function processFrames(finish) {
  if (!stream) return;
  if (finish) {
    stream.acceptWaveform({ samples: new Float32Array(6400), sampleRate: 16000 });
    stream.inputFinished();
  }
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
    if (recognizer.isEndpoint(stream) && !finish) {
      const spoken = normalize(recognizer.getResult(stream).text);
      if (spoken) {
        committed = [committed, spoken].filter(Boolean).join(" ");
        publishText("partial", committed);
      }
      recognizer.reset(stream);
    }
  }
  const partial = normalize(recognizer.getResult(stream).text);
  const text = [committed, partial].filter(Boolean).join(" ").trim();
  publishText(finish ? "final" : "partial", text);
}
parentPort.on("message", ({ type, audio }) => {
  try {
    if (type === "finish") {
      if (finalizing) return;
      finalizing = true;
      processFrames(true);
      return;
    }
    if (type !== "audio" || !stream || finalizing) return;
    const bytes = Buffer.from(audio);
    if (bytes.length % 2 !== 0 || bytes.length > 65536) throw Error("Invalid PCM chunk");
    const values = new Float32Array(bytes.length / 2);
    for (let i = 0; i < values.length; i++) values[i] = bytes.readInt16LE(i * 2) / 32768;
    stream.acceptWaveform({ samples: values, sampleRate: 16000 });
    processFrames(false);
  } catch (e) {
    parentPort.postMessage({ type: "error", error: String(e?.message || e) });
  }
});
